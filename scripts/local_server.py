"""Local dev server: serves frontend/ and routes /api/* to the Lambda handler.
DynamoDB is mocked with moto; Bedrock is faked unless REAL_BEDROCK=1.
Usage: python3 scripts/local_server.py [port]"""
import json, os, sys, http.server, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("TABLE_NAME", "banjirsiap-local")
use_moto = os.environ.get("REAL_DDB") != "1"
if use_moto:
    os.environ.setdefault("AWS_ACCESS_KEY_ID", "x"); os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "x")
    from moto import mock_aws
    mock_aws().start()
import boto3, app  # noqa
if use_moto:
    boto3.client("dynamodb").create_table(TableName=os.environ["TABLE_NAME"], BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}, {"AttributeName": "sk", "AttributeType": "S"}],
        KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}])


class FakeBedrock:
    def converse(self, modelId, system, messages, inferenceConfig):
        s = system[0]["text"]
        if "flood-preparedness planner" in s:
            out = {"headline": "Your ground-floor home near the river needs a plan to leave early, with Nenek going first.",
                   "goBag": [{"item": "IC, birth certs, geran in a zip bag", "why": "Needed for aid and claims", "priority": "must"},
                             {"item": "Nenek's daily medicines (7 days)", "why": "Pharmacies close in floods", "priority": "must"},
                             {"item": "6 litres drinking water", "why": "Tap water may be contaminated", "priority": "must"},
                             {"item": "Power bank 20,000 mAh", "why": "Stay reachable for rescuers", "priority": "must"},
                             {"item": "Torchlight + batteries", "why": "Power is often cut", "priority": "must"},
                             {"item": "Cat carrier and 3 days of food", "why": "PPS may not accept loose pets", "priority": "should"},
                             {"item": "RM200 cash in small notes", "why": "DuitNow may be down", "priority": "should"},
                             {"item": "Raincoat and spare clothes", "why": "Stay warm and dry", "priority": "should"},
                             {"item": "Whistle", "why": "Signal for help", "priority": "should"},
                             {"item": "Biscuits and canned food", "why": "No cooking needed", "priority": "must"}],
                   "stages": [{"level": "waspada", "actions": ["Charge all phones", "Move documents upstairs", "Check go-bag"]},
                              {"level": "amaran", "actions": ["Move car to multi-storey car park", "Bring Nenek to relatives on higher ground", "Switch off main power if water nears plugs"]},
                              {"level": "bahaya", "actions": ["Leave now with go-bag", "Do not drive through water", "Check in as Evacuated in your group"]}],
                   "leaveTrigger": "Leave at Amaran, before water reaches the road, because Nenek needs extra time.",
                   "householdNotes": ["Move Nenek first; wheelchairs cannot cross flooded roads", "Put the cats in carriers early"],
                   "afterFlood": ["Get electrician to check wiring", "Photograph damage for claims", "Clean with bleach and wear boots"]}
        elif "coordination assistant" in s:
            rows = json.loads(messages[0]["content"][0]["text"].split("priority order: ", 1)[1])
            out = {"sitrep": f"{len(rows)} households need help. Water is knee to waist deep on Jalan 3 and 5. Two cases need professional rescue.",
                   "actions": [{"id": r["id"], "action": f"Contact {r['name']} by phone; prepare to assist from dry ground", "escalate": r["priority"] > 100} for r in rows],
                   "supplies": ["2 cartons bottled water", "Infant formula + diapers", "4 power banks", "Life jackets x4"],
                   "broadcast": "Banjir update: Please stay upstairs and keep phones charged. Volunteers with boats please reply. Do NOT walk through moving water. Call 999 for emergencies."}
        else:
            out = {"isFloodScene": True, "depth": "knee", "depthCm": 45, "flowing": "slow",
                   "references": "Water reaches car wheel hubs and motorcycle seats", "hazards": ["Hidden open drains", "Floating debris"],
                   "summary": "Street flooded to about knee depth with slow-moving brown water."}
        return {"output": {"message": {"content": [{"text": json.dumps(out)}]}}}


if os.environ.get("REAL_BEDROCK") != "1":
    app._bedrock = FakeBedrock()


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT / "frontend"), **k)

    def _api(self):
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n).decode() if n else None
        path, _, q = self.path.partition("?")
        qs = dict(p.split("=", 1) for p in q.split("&") if "=" in p) if q else None
        ev = {"rawPath": path, "requestContext": {"http": {"method": self.command}}, "queryStringParameters": qs, "body": body}
        r = app.handler(ev, None)
        self.send_response(r["statusCode"])
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(r["body"].encode())

    def do_GET(self):
        return self._api() if self.path.startswith("/api/") else super().do_GET()

    def do_POST(self):
        return self._api()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"http://localhost:{port}")
    http.server.ThreadingHTTPServer(("", port), H).serve_forever()
