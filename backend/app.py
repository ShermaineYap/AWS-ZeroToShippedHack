"""BanjirSiap API — one Lambda, routed by path.

Design rule for safety: deterministic code decides (risk scores, triage order,
emergency numbers); the LLM only personalises and explains.
"""
import base64
import json
import os
import re
import secrets
import time
import uuid
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

TABLE_NAME = os.environ.get("TABLE_NAME", "banjirsiap")
MODEL_IDS = [m for m in [
    os.environ.get("MODEL_ID"),
    "us.amazon.nova-lite-v1:0",
    "us.amazon.nova-2-lite-v1:0",
    "amazon.nova-lite-v1:0",
] if m]

_ddb = None
_bedrock = None
_rek = None

LANGS = {"en": "English", "ms": "Bahasa Melayu", "zh": "Simplified Chinese (简体中文)", "ta": "Tamil (தமிழ்)"}
DAY = 86400


def table():
    global _ddb
    if _ddb is None:
        _ddb = boto3.resource("dynamodb").Table(TABLE_NAME)
    return _ddb


def bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime")
    return _bedrock


def rekognition():
    global _rek
    if _rek is None:
        _rek = boto3.client("rekognition")
    return _rek


# ---------------------------------------------------------------- helpers
class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status
        self.msg = msg


def _json_default(o):
    if isinstance(o, Decimal):
        return int(o) if o == int(o) else float(o)
    raise TypeError


def resp(status, body):
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body, default=_json_default, ensure_ascii=False),
    }


def clean(s, n=200):
    if s is None:
        return ""
    s = re.sub(r"[\x00-\x1f<>]", " ", str(s)).strip()
    return s[:n]


def lang_of(body):
    lang = (body or {}).get("lang", "en")
    return lang if lang in LANGS else "en"


def now():
    return int(time.time())


def extract_json(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no json")
    return json.loads(text[start:end + 1])


def ask_model(system, content, max_tokens=1800, temperature=0.4):
    """Call Bedrock Converse with model fallback. Returns parsed JSON dict."""
    last = None
    for model in MODEL_IDS:
        try:
            r = bedrock().converse(
                modelId=model,
                system=[{"text": system}],
                messages=[{"role": "user", "content": content}],
                inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
            )
            text = "".join(c.get("text", "") for c in r["output"]["message"]["content"])
            out = extract_json(text)
            out["_model"] = model
            return out
        except (ClientError, ValueError, KeyError) as e:  # try next model
            last = e
            print(f"model {model} failed: {e}")
    raise ApiError(503, f"AI unavailable: {last}")


def bump(stat, n=1):
    try:
        table().update_item(
            Key={"pk": "STATS", "sk": "GLOBAL"},
            UpdateExpression="ADD #s :n",
            ExpressionAttributeNames={"#s": stat},
            ExpressionAttributeValues={":n": n},
        )
    except Exception as e:  # stats must never break a request
        print("stat fail", e)


# ---------------------------------------------------------------- risk rules
HOUSE_RISK = {"landed1": 30, "landed2": 15, "apt_low": 25, "apt_high": 0, "kampung": 30}


def household_risk(a):
    score = 0
    score += HOUSE_RISK.get(a.get("house"), 15)
    past = a.get("pastFlood")
    score += {"often": 35, "once": 20, "never": 0}.get(past, 10)
    score += {"river": 20, "lowland": 15, "hill": 0}.get(a.get("terrain"), 8)
    vuln = int(a.get("elderly", 0) or 0) + int(a.get("children", 0) or 0)
    score += min(vuln * 5, 15)
    if a.get("mobility"):
        score += 10
    level = "high" if score >= 60 else "moderate" if score >= 35 else "low"
    return min(score, 100), level


# ---------------------------------------------------------------- plan
PLAN_SYSTEM = """You are BanjirSiap, a flood-preparedness planner for households in Malaysia.
Write for ordinary families: short, concrete, kind, no jargon. Malaysian context:
- JPS (Jabatan Pengairan dan Saliran) river alert levels: Normal, Waspada (alert), Amaran (warning), Bahaya (danger).
- Evacuation centres are PPS (Pusat Pemindahan Sementara), managed with JKM/NADMA.
- Monsoon (Monsun Timur Laut) is roughly November to March.
STRICT RULES: Never invent phone numbers, URLs, addresses or names of specific PPS. Do not give medical dosing advice.
Write every string value in {lang}. Keep enum fields (priority, level) in English exactly as given.
Always write the alert level names exactly as Waspada, Amaran, Bahaya (Latin script), even inside other languages.
QUALITY BAR: be specific and personal, never generic. Mention the household's actual members (e.g. the elderly person, the children, the wheelchair user, the pets), home type and vehicle.
Go-bag items must include quantities sized to the number of people (e.g. "9 litres of water (3 people x 3 days)"). Actions must be concrete verbs a family can do in minutes.
Return ONLY a JSON object, no markdown, with this shape:
{"headline": str (max 20 words, personal, e.g. naming their biggest risk and the one thing to do first),
 "goBag": [{"item": str, "why": str (max 12 words), "priority": "must"|"should"}] (10-14 items, tailored to the household),
 "stages": [{"level": "waspada", "actions": [str,str,str]}, {"level": "amaran", "actions": [str,str,str]}, {"level": "bahaya", "actions": [str,str,str]}],
 "leaveTrigger": str (one clear, observable rule for when THIS household must leave, earlier if they have elderly, wheelchair users or young children),
 "householdNotes": [str] (2-4 notes specific to their members, pets, vehicle, home),
 "afterFlood": [str,str,str]}"""


def fallback_plan(a):
    return {
        "headline": "Your basic flood plan (AI is busy - this is the standard checklist).",
        "goBag": [
            {"item": "IC, passports, land titles in a waterproof bag", "why": "Needed for aid and insurance claims", "priority": "must"},
            {"item": "3 days of drinking water", "why": "Tap water may be unsafe", "priority": "must"},
            {"item": "Ready-to-eat food for 3 days", "why": "Cooking may be impossible", "priority": "must"},
            {"item": "Daily medicines and prescriptions", "why": "Clinics may be closed", "priority": "must"},
            {"item": "Power bank and charging cables", "why": "Stay reachable", "priority": "must"},
            {"item": "Torchlight and spare batteries", "why": "Power is often cut", "priority": "must"},
            {"item": "Cash in small notes", "why": "Card terminals may be down", "priority": "should"},
            {"item": "Change of clothes and raincoat", "why": "Stay warm and dry", "priority": "should"},
            {"item": "Whistle", "why": "Signal rescuers", "priority": "should"},
            {"item": "First-aid kit", "why": "Treat small injuries", "priority": "should"},
        ],
        "stages": [
            {"level": "waspada", "actions": ["Charge phones and power banks", "Move valuables and documents upstairs", "Check your go-bag"]},
            {"level": "amaran", "actions": ["Move car to higher ground", "Switch off main electricity if water may enter", "Tell your neighbourhood group your status"]},
            {"level": "bahaya", "actions": ["Leave now with your go-bag", "Never walk or drive through moving water", "Go to the nearest PPS announced by authorities"]},
        ],
        "leaveTrigger": "Leave as soon as authorities announce Bahaya for your area or water reaches your doorstep.",
        "householdNotes": [],
        "afterFlood": ["Do not switch on electricity until checked", "Photograph damage for claims", "Boil water before drinking"],
        "_model": "fallback",
    }


def create_plan(body):
    a = body.get("answers") or {}
    lang = lang_of(body)
    score, level = household_risk(a)
    profile = {
        "state": clean(a.get("state"), 40),
        "area": clean(a.get("area"), 60),
        "house": clean(a.get("house"), 20),
        "terrain": clean(a.get("terrain"), 20),
        "pastFlood": clean(a.get("pastFlood"), 10),
        "adults": int(a.get("adults", 1) or 1),
        "children": int(a.get("children", 0) or 0),
        "elderly": int(a.get("elderly", 0) or 0),
        "mobility": bool(a.get("mobility")),
        "pets": clean(a.get("pets"), 40),
        "vehicle": clean(a.get("vehicle"), 20),
        "riskLevel": level,
    }
    profile["totalPeople"] = profile["adults"] + profile["children"] + profile["elderly"]
    prompt = ("Household profile (JSON): " + json.dumps(profile, ensure_ascii=False) +
              f"\nHousehold size is exactly {profile['totalPeople']} people: size water as {profile['totalPeople'] * 9} litres ({profile['totalPeople']} people x 3 litres x 3 days) and food/medicine for {profile['totalPeople']} people."
              f"\nOur rule-based risk level for this home is '{level}' (score {score}/100). "
              "Make the plan proportionate to that risk.")
    try:
        plan = ask_model(PLAN_SYSTEM.replace("{lang}", LANGS[lang]), [{"text": prompt}])
    except ApiError:
        plan = fallback_plan(a)
    plan["riskLevel"], plan["riskScore"] = level, score
    plan_id = uuid.uuid4().hex[:10]
    item = {"pk": f"PLAN#{plan_id}", "sk": "PLAN", "plan": json.dumps(plan, ensure_ascii=False),
            "profile": json.dumps(profile, ensure_ascii=False), "lang": lang,
            "created": now(), "ttl": now() + 180 * DAY}
    table().put_item(Item=item)
    bump("plans")
    return {"id": plan_id, "plan": plan, "profile": profile, "lang": lang}


def get_plan(plan_id):
    r = table().get_item(Key={"pk": f"PLAN#{clean(plan_id, 20)}", "sk": "PLAN"}).get("Item")
    if not r:
        raise ApiError(404, "plan not found")
    return {"id": plan_id, "plan": json.loads(r["plan"]), "profile": json.loads(r["profile"]), "lang": r.get("lang", "en")}


# ---------------------------------------------------------------- groups
NEED_POINTS = {"elderly": 25, "mobility": 30, "medical": 25, "infant": 20, "child": 10, "pregnant": 20, "pet": 3}
WATER_POINTS = {"none": 0, "ankle": 5, "knee": 15, "waist": 30, "chest": 45}


def priority(c):
    if c.get("status") != "help":
        return 0
    p = 40
    for n in c.get("needs", []):
        p += NEED_POINTS.get(n, 0)
    p += WATER_POINTS.get(c.get("water"), 0)
    p += min(max(int(c.get("people", 1)) - 2, 0) * 3, 12)
    waited_min = (now() - int(c.get("updated", now()))) // 60
    p += min(waited_min // 10 * 2, 20)
    return min(p, 150)


def create_group(body):
    name = clean(body.get("name"), 80)
    if not name:
        raise ApiError(400, "name required")
    gid = uuid.uuid4().hex[:8]
    key = secrets.token_urlsafe(12)
    table().put_item(Item={
        "pk": f"GROUP#{gid}", "sk": "META", "name": name, "area": clean(body.get("area"), 80),
        "coordinator": clean(body.get("coordinator"), 60), "lang": lang_of(body),
        "adminKey": key, "created": now(), "ttl": now() + 120 * DAY,
        "demo": bool(body.get("_demo")),
    })
    bump("groups")
    return {"id": gid, "adminKey": key}


def load_group(gid):
    gid = clean(gid, 20)
    items = table().query(
        KeyConditionExpression=Key("pk").eq(f"GROUP#{gid}")
    ).get("Items", [])
    meta = next((i for i in items if i["sk"] == "META"), None)
    if not meta:
        raise ApiError(404, "group not found")
    members = [i for i in items if i["sk"].startswith("M#")]
    triage = next((i for i in items if i["sk"] == "TRIAGE"), None)
    return meta, members, triage


def summarize(members):
    s = {"safe": 0, "help": 0, "evacuated": 0, "people": 0}
    for m in members:
        s[m.get("status", "safe")] = s.get(m.get("status", "safe"), 0) + 1
        s["people"] += int(m.get("people", 1))
    return s


def get_group(gid, key):
    meta, members, triage = load_group(gid)
    out = {"id": gid, "name": meta["name"], "area": meta.get("area", ""), "lang": meta.get("lang", "en"),
           "coordinator": meta.get("coordinator", ""), "counts": summarize(members), "demo": meta.get("demo", False)}
    if key and secrets.compare_digest(str(key), meta["adminKey"]):
        ms = []
        for m in members:
            d = {k: m[k] for k in ("sk", "name", "unit", "status", "needs", "water", "people", "note", "updated", "phone") if k in m}
            d["id"] = d.pop("sk")[2:]
            d["priority"] = priority(m)
            ms.append(d)
        ms.sort(key=lambda m: (-m["priority"], m.get("updated", 0)))
        out["members"] = ms
        out["admin"] = True
        if triage:
            out["triage"] = json.loads(triage["data"])
    return out


def checkin(gid, body):
    meta, _, _ = load_group(gid)
    mid = clean(body.get("memberId"), 40) or uuid.uuid4().hex
    status = body.get("status")
    if status not in ("safe", "help", "evacuated"):
        raise ApiError(400, "bad status")
    needs = [n for n in (body.get("needs") or []) if n in NEED_POINTS][:8]
    water = body.get("water") if body.get("water") in WATER_POINTS else "none"
    item = {"pk": f"GROUP#{clean(gid, 20)}", "sk": f"M#{mid}", "name": clean(body.get("name"), 60) or "?",
            "unit": clean(body.get("unit"), 60), "status": status, "needs": needs, "water": water,
            "people": max(1, min(int(body.get("people", 1) or 1), 30)), "note": clean(body.get("note"), 280),
            "phone": clean(body.get("phone"), 20), "updated": now(), "ttl": now() + 30 * DAY}
    table().put_item(Item=item)
    bump("checkins")
    return {"ok": True, "memberId": mid, "group": meta["name"]}


TRIAGE_SYSTEM = """You are the coordination assistant for a Malaysian neighbourhood flood-response group (RT / JMB / residents' association).
Volunteers are ordinary residents, not professional rescuers. A rule engine has ALREADY ranked help requests by priority; do not reorder them.
Your job: explain and plan. Write all strings in {lang}.
SAFETY: Volunteers must never enter moving water or water above knee level; for life-threatening cases tell them to call 999 and alert APM/Bomba. Never invent phone numbers.
Wheelchair or bedridden residents cannot "move upstairs" by themselves: plan a carry/evacuation team or professional rescue. Be specific: name residents and units, say exactly what to bring or do. Volunteers on the safe list (e.g. someone with a boat) can be suggested as helpers.
Return ONLY JSON:
{"sitrep": str (2-3 sentences situation report),
 "actions": [{"id": str (member id), "action": str (max 20 words, what a volunteer should do), "escalate": true|false (true if professional rescue needed)}] (one per help request, same order),
 "supplies": [str] (3-6 items to gather, with quantities),
 "broadcast": str (a short WhatsApp message the coordinator can send to the whole group, max 60 words)}"""


def run_triage(gid, body):
    meta, members, _ = load_group(gid)
    if not secrets.compare_digest(str(body.get("key", "")), meta["adminKey"]):
        raise ApiError(403, "coordinator key required")
    lang = lang_of(body) if body.get("lang") else meta.get("lang", "en")
    helps = sorted([m for m in members if m.get("status") == "help"], key=lambda m: -priority(m))
    rows = [{"id": m["sk"][2:], "name": m.get("name"), "unit": m.get("unit"), "needs": m.get("needs", []),
             "water": m.get("water"), "people": int(m.get("people", 1)), "note": m.get("note", ""),
             "priority": priority(m)} for m in helps]
    counts = summarize(members)
    prompt = (f"Group: {meta['name']} ({meta.get('area', '')}). Counts: {json.dumps(counts)}.\n"
              f"Help requests in priority order: {json.dumps(rows, ensure_ascii=False)}")
    data = ask_model(TRIAGE_SYSTEM.replace("{lang}", LANGS[lang]), [{"text": prompt}], max_tokens=2000, temperature=0.3)
    # Rules decide escalation; AI only explains. Never under-escalate a high-risk case.
    by_id = {r["id"]: r for r in rows}
    deep = ("knee", "waist", "chest")
    for a in data.get("actions", []):
        r = by_id.get(a.get("id"))
        if not r:
            continue
        must = (r["priority"] >= 100 or r["water"] == "chest"
                or ("mobility" in r["needs"] and r["water"] in deep)
                or ("medical" in r["needs"] and r["water"] in ("waist", "chest")))
        a["escalate"] = bool(a.get("escalate")) or must
    data["generated"] = now()
    table().put_item(Item={"pk": f"GROUP#{clean(gid, 20)}", "sk": "TRIAGE", "data": json.dumps(data, ensure_ascii=False),
                           "ttl": now() + 30 * DAY})
    bump("triages")
    return data


# ---------------------------------------------------------------- photo
PHOTO_SYSTEM = """You are a flood-safety vision assistant in Malaysia. Look at the photo and estimate floodwater conditions.
Measure depth against reference objects of known real-world height (Malaysian context):
car wheel diameter ~62 cm (hub centre ~32 cm), sedan roof ~145 cm, SUV/pickup roof ~175 cm, lorry wheel ~100 cm,
motorcycle seat ~78 cm, adult person ~160 cm (knee ~45 cm, hip/waist ~95 cm, chest ~125 cm), kerb ~15 cm, door handle ~100 cm, house door ~210 cm.
An object detector may list objects it found with normalised boxes [left, top, width, height]; use them to locate references.
Only measure against objects that are standing IN the floodwater; ignore objects on bridges, flyovers, raised roads or dry ground, even if the detector lists them. Prefer wheels, people, house doors, windows and fences in the water. In aerial shots, judge how far up house walls, doors and fences the water reaches; if ground floors look inundated, depth is at least waist. Estimate how much of that reference object is under water, and derive depth from that. Be conservative: if unsure, pick the deeper category.
Write all free-text strings in {lang}; keep enum values in English exactly.
Return ONLY JSON:
{"isFloodScene": true|false,
 "depth": "none"|"ankle"|"knee"|"waist"|"chest",
 "depthCm": int (best estimate),
 "flowing": "still"|"slow"|"fast"|"unknown",
 "referenceObject": str (the object you measured against, in English, e.g. "car wheel"),
 "submergedFraction": number 0-1 (fraction of that reference object's height under water),
 "references": str (what you used to judge depth, max 20 words),
 "hazards": [str] (visible hazards e.g. open drains, debris, power lines; max 4),
 "summary": str (one sentence)}"""

REF_LABELS = {"Car", "Person", "Truck", "Motorcycle", "Bus", "Bicycle", "Wheel", "Van", "Boat", "Pickup Truck", "Tire"}
FLOOD_LABELS = {"Flood"}
WATER_LABELS = {"Water", "Puddle", "Rain"}


def detect_objects(raw):
    """Amazon Rekognition: reference objects with boxes + flood/water label confidence."""
    try:
        r = rekognition().detect_labels(Image={"Bytes": raw}, MaxLabels=50, MinConfidence=55)
    except Exception as e:  # vision grounding is best-effort
        print("rekognition failed", e)
        return None
    det, flood, water = [], 0.0, 0.0
    for lab in r.get("Labels", []):
        name, conf = lab["Name"], lab["Confidence"]
        if name in FLOOD_LABELS:
            flood = max(flood, conf)
        if name in WATER_LABELS:
            water = max(water, conf)
        if name in REF_LABELS:
            for inst in lab.get("Instances", [])[:6]:
                b = inst["BoundingBox"]
                det.append({"label": name, "conf": round(inst.get("Confidence", conf)),
                            "box": [round(b["Left"], 3), round(b["Top"], 3), round(b["Width"], 3), round(b["Height"], 3)]})
    det.sort(key=lambda d: -d["conf"])
    return {"objects": det[:14], "flood": round(flood), "water": round(water)}


# Deterministic safety verdicts (never left to the LLM). Rule of thumb from flood-safety
# guidance: 15 cm of moving water can knock an adult down; ~30 cm can float a car.
def verdict(depth_cm, flowing):
    moving = flowing in ("slow", "fast", "unknown")
    walk = "no" if depth_cm >= 30 or (moving and depth_cm >= 15) else "caution" if depth_cm >= 5 else "ok"
    car = "no" if depth_cm >= 15 or (moving and depth_cm >= 10) else "caution" if depth_cm >= 5 else "ok"
    moto = "no" if depth_cm >= 10 else "caution" if depth_cm >= 3 else "ok"
    stay = "evacuate" if depth_cm >= 50 else "prepare" if depth_cm >= 15 else "monitor"
    return {"walk": walk, "car": car, "motorcycle": moto, "home": stay}


def photo_check(body):
    lang = lang_of(body)
    img = body.get("image", "")
    m = re.match(r"data:image/(jpeg|jpg|png|webp);base64,(.*)", img, re.S)
    if not m:
        raise ApiError(400, "image must be a data URL (jpeg/png/webp)")
    fmt = "jpeg" if m.group(1) == "jpg" else m.group(1)
    raw = base64.b64decode(m.group(2))
    if len(raw) > 3_500_000:
        raise ApiError(413, "image too large")
    # Stage 1: classic CV detector (Amazon Rekognition) finds reference objects + flood evidence
    det = detect_objects(raw)
    hint = "Assess this scene."
    if det:
        objs = ", ".join(f"{o['label']} {o['conf']}% box={o['box']}" for o in det["objects"]) or "none"
        hint = (f"Object detector found: {objs}. Detector 'Flood' label confidence: {det['flood']}%, "
                f"'Water' label confidence: {det['water']}%. Assess this scene.")
    # Stage 2: multimodal LLM measures depth against those references
    # Two independent readings in parallel (self-consistency); keep the deeper, i.e. safer, one.
    from concurrent.futures import ThreadPoolExecutor
    call = lambda temp: ask_model(PHOTO_SYSTEM.replace("{lang}", LANGS[lang]),
                                  [{"image": {"format": fmt, "source": {"bytes": raw}}}, {"text": hint}],
                                  max_tokens=800, temperature=temp)
    with ThreadPoolExecutor(2) as ex:
        futs = [ex.submit(call, 0.1), ex.submit(call, 0.5)]
        readings = []
        for f in futs:
            try:
                readings.append(f.result())
            except ApiError:
                pass
    if not readings:
        raise ApiError(503, "AI unavailable")
    score = lambda r: (bool(r.get("isFloodScene")), int(r.get("depthCm", 0) or 0))
    readings.sort(key=score, reverse=True)
    data = readings[0]
    data["readingsCm"] = [int(r.get("depthCm", 0) or 0) if r.get("isFloodScene") else 0 for r in readings]
    depth_cm = max(0, min(int(data.get("depthCm", 0) or 0), 300))
    # Stage 3: deterministic consensus. If the two models disagree, take the safer reading.
    llm_flood = bool(data.get("isFloodScene"))
    det_flood = bool(det and (det["flood"] >= 70))
    agree = det is None or llm_flood == det_flood or (llm_flood and det and det["water"] >= 70)
    if det_flood and not llm_flood:
        data["isFloodScene"] = True
        depth_cm = max(depth_cm, 15)
        data["depth"] = data.get("depth") if data.get("depth") not in (None, "none") else "ankle"
    if not data.get("isFloodScene"):
        depth_cm = 0
    data["depthCm"] = depth_cm
    data["verdict"] = verdict(depth_cm, data.get("flowing", "unknown") if agree else "unknown")
    data["vision"] = {
        "detector": "Amazon Rekognition" if det else None,
        "objects": det["objects"] if det else [],
        "floodConfidence": det["flood"] if det else None,
        "waterConfidence": det["water"] if det else None,
        "agree": bool(agree),
    }
    bump("photos")
    return data  # photo itself is never stored


# ---------------------------------------------------------------- demo + stats
DEMO_MEMBERS = [
    ("Mak Cik Rohani", "No. 12, Jalan 3", "help", ["elderly", "mobility"], "knee", 2, "Wheelchair, ground floor, water entering kitchen", 25),
    ("Encik Kumar", "No. 7, Jalan 1", "help", ["infant"], "ankle", 4, "Baby 6 months, need milk & diapers", 12),
    ("Lim family", "No. 30, Jalan 5", "help", ["medical"], "waist", 3, "Father on dialysis Tuesday, car flooded", 40),
    ("Aisyah", "No. 2, Jalan 2", "help", ["pet"], "ankle", 1, "Stuck with 2 cats, phone 15%", 5),
    ("Pak Hamid", "No. 18, Jalan 3", "safe", [], "none", 5, "Upstairs, have food for 3 days", 30),
    ("Chen Wei", "No. 21, Jalan 4", "evacuated", [], "none", 3, "At PPS Dewan Serbaguna", 50),
    ("Priya", "No. 9, Jalan 1", "safe", ["child"], "ankle", 4, "", 18),
    ("Encik Faizal", "No. 25, Jalan 5", "safe", [], "none", 2, "Have a boat, can help", 8),
    ("Mrs. Tan", "No. 4, Jalan 2", "evacuated", ["elderly"], "none", 2, "Son picked us up", 60),
    ("Rahman", "No. 15, Jalan 4", "safe", [], "knee", 1, "", 3),
]


def create_demo(body):
    g = create_group({"name": "Taman Seri Harmoni Residents (Demo)", "area": "Shah Alam, Selangor",
                      "coordinator": "Puan Zarina", "lang": lang_of(body), "_demo": True})
    with table().batch_writer() as bw:
        for i, (name, unit, st, needs, water, ppl, note, ago) in enumerate(DEMO_MEMBERS):
            bw.put_item(Item={"pk": f"GROUP#{g['id']}", "sk": f"M#demo{i}", "name": name, "unit": unit, "status": st,
                              "needs": needs, "water": water, "people": ppl, "note": note, "phone": "",
                              "updated": now() - ago * 60, "ttl": now() + 2 * DAY})
    return g


def stats():
    r = table().get_item(Key={"pk": "STATS", "sk": "GLOBAL"}).get("Item") or {}
    return {k: r.get(k, 0) for k in ("plans", "groups", "checkins", "photos", "triages")}


# ---------------------------------------------------------------- router
def handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", event.get("httpMethod", "GET"))
    path = event.get("rawPath") or event.get("path") or "/"
    path = re.sub(r"^/api", "", path) or "/"
    qs = event.get("queryStringParameters") or {}
    body = {}
    if event.get("body"):
        raw = event["body"]
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode()
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            return resp(400, {"error": "invalid json"})
    try:
        parts = [p for p in path.split("/") if p]
        if method == "GET" and parts == ["health"]:
            return resp(200, {"ok": True, "models": MODEL_IDS})
        if method == "GET" and parts == ["stats"]:
            return resp(200, stats())
        if method == "POST" and parts == ["plans"]:
            return resp(200, create_plan(body))
        if method == "GET" and len(parts) == 2 and parts[0] == "plans":
            return resp(200, get_plan(parts[1]))
        if method == "POST" and parts == ["groups"]:
            return resp(200, create_group(body))
        if method == "POST" and parts == ["demo"]:
            return resp(200, create_demo(body))
        if method == "GET" and len(parts) == 2 and parts[0] == "groups":
            return resp(200, get_group(parts[1], qs.get("key")))
        if method == "POST" and len(parts) == 3 and parts[0] == "groups" and parts[2] == "checkins":
            return resp(200, checkin(parts[1], body))
        if method == "POST" and len(parts) == 3 and parts[0] == "groups" and parts[2] == "triage":
            return resp(200, run_triage(parts[1], body))
        if method == "POST" and parts == ["photo"]:
            return resp(200, photo_check(body))
        return resp(404, {"error": "not found"})
    except ApiError as e:
        return resp(e.status, {"error": e.msg})
    except Exception as e:  # noqa
        print("unhandled", repr(e))
        return resp(500, {"error": "server error"})
