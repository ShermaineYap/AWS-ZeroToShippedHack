# BanjirSiap: Ready before the flood, together after it

**Live app:** https://d1auxcg6lvocbo.cloudfront.net
**Category:** #social-good (Climate resilience) · **Lane:** #community
**Built with:** Claude (AI coding agent, connected to my AWS account through the AWS CLI) · Amazon Bedrock (Amazon Nova) · AWS Lambda · Amazon API Gateway · Amazon DynamoDB · Amazon S3 · Amazon CloudFront · AWS CloudFormation/SAM

> **Try it in 30 seconds:** open the live app and tap **"Try the live demo board"**. You get a sample flooded neighbourhood. Press **"AI triage"** to watch Amazon Bedrock turn a page of WhatsApp-style chaos into a prioritised rescue plan.

---

## 1. The story: one night in Taman Sri Muda

From **16 December 2021**, three days of torrential rain from Tropical Depression 29W hit the Klang Valley. Within days, whole townships in Selangor were under water. **Taman Sri Muda in Shah Alam** was among the hardest hit, with 14 confirmed deaths there alone. Nationwide, the floods killed **54 people**, displaced up to **71,000 at their peak**, and affected over **125,000**. The Department of Statistics Malaysia estimated losses of **RM6.1 billion**.

What failed that night wasn't only drainage. It was **coordination**:

- Families didn't know **when** to leave, and waited until the water was at chest height.
- Elderly and wheelchair-bound neighbours were trapped on ground floors while able-bodied residents on the same street were safe upstairs.
- Neighbourhood WhatsApp groups exploded into hundreds of unstructured messages. The people who most needed rescue were the hardest to find.
- Official aid was widely reported as slow, and **volunteers became the first responders**.

Malaysia's northeast monsoon returns every November. **BanjirSiap** ("flood-ready" in Malay) is built for the people who will be the first responders again: families, and the residents' associations (RT, JMB, rukun tetangga) that hold their WhatsApp groups together.

## 2. What it does

### 📋 My Flood Plan: a household plan in 60 seconds
Six tap-to-answer questions (state, home type, terrain, flood history, who lives with you, vehicle) produce a personal plan **in English, Bahasa Melayu, 中文 or தமிழ்**:
- A transparent **risk score** (0–100) from rule-based scoring, not an AI guess
- A **"Leave when…" trigger** written for this household (for example, "Leave at Amaran, because Nenek needs extra time")
- **Actions for each official JPS river alert level**: Waspada → Amaran → Bahaya
- A tailored **go-bag checklist** with progress tracking, household-specific notes (elderly, kids, pets, vehicle), and after-flood steps
- Hard-coded emergency numbers (999, 112, 994 Bomba, 991 APM) and the official JPS InfoBanjir river-level link
- Shareable link and print/PDF for the fridge door

### 🏘️ Neighbourhood Check-in: replace WhatsApp chaos with a live board
A coordinator creates a group in 10 seconds and gets two links:
- A **resident link** (with a QR code and a one-tap WhatsApp invite). Residents tap **✅ Safe / 🆘 Need help / 🚐 Evacuated**, pick the water level on a body diagram (ankle → chest), and flag special needs (elderly, wheelchair, medical, baby, pregnant, pets). No app install, no sign-up.
- A private **coordinator board** that live-refreshes, shows counts, and **ranks every help request by a transparent priority score** (vulnerability + water depth + household size + waiting time).
- **🧠 AI triage** (Amazon Bedrock): one tap produces a situation report, a concrete volunteer action per household, an **escalation flag** for cases that need professional rescue (call 999 / APM), a supplies list with quantities, and a ready-to-send **WhatsApp broadcast**, all in the coordinator's language.

### 📸 Photo Water Check: "Can I cross this?"
Snap the street. **Amazon Nova's multimodal vision** estimates water depth from visual references (kerbs, car wheels, legs), water movement, and visible hazards (open drains, debris, power lines). Then **deterministic safety rules**, not the model, give the verdict for Walking / Car / Motorcycle / Your home. These rules are based on the widely taught rule of thumb that *15 cm of moving water can knock you down and 30 cm can float a car*. The photo is analysed in memory and **never stored**.

## 3. Technical innovation

![Architecture](architecture.png)

**Fully serverless, defined as one SAM/CloudFormation template, deployed with one command (`./deploy.sh`):**

| Layer | Service | Why |
|---|---|---|
| Edge | **Amazon CloudFront** | HTTPS, global CDN, security headers; routes `/api/*` to the API so the app is single-origin (no CORS) |
| Static app | **Amazon S3** (private, OAC) | Vanilla JS, no build step, about 40 KB, loads fast on 3G during a storm |
| API | **Amazon API Gateway HTTP API** | Throttled (15 rps / 30 burst) to cap cost and abuse |
| Compute | **AWS Lambda** (Python 3.12, Graviton arm64) | Single router function: rules engine + Bedrock orchestration |
| AI | **Amazon Bedrock Converse API**, Amazon Nova Pro (fallback: Nova Lite) | Text and vision in one model; structured-JSON prompting; **automatic model fallback chain** |
| Data | **Amazon DynamoDB** (on-demand, single-table, PITR, SSE) | **TTL auto-deletes** check-ins after 30 days for privacy |

**Engineering ideas I'm proud of:**
1. **"Rules decide, AI explains."** In a disaster, a hallucination can kill. Every safety-critical output (risk score, triage order, walk/drive verdict, emergency numbers) is computed by small, auditable functions. Bedrock is used where it shines: personalisation, multilingual writing, summarising chaos, and reading a photo. The two layers are composed: rule outputs are passed into the prompt as facts.
2. **Resilience by design.** If Bedrock is throttled or unavailable, the plan endpoint falls back to a curated standard checklist, and the board still sorts by the rule-based priority. The Lambda tries a chain of Nova model IDs/inference profiles before failing.
3. **Multimodal + multilingual in one call.** The same Nova model handles images and writes in four Malaysian languages, including Tamil script, with no translation layer.
4. **Zero-friction UX for stressful moments.** No accounts, no install, big tap targets, offline-friendly local storage for the go-bag checklist, WhatsApp deep links, a QR code for the guardhouse noticeboard, print-ready plans.
5. **Privacy by architecture.** Groups are unlisted; only the secret coordinator link reveals names and addresses. Photos are never persisted. Data expires automatically.

### 👁️ Vision v2: a three-stage computer-vision pipeline
1. **MediaPipe Face Detector (on-device, WebAssembly)** pixelates neighbours' faces before upload.
2. **Amazon Rekognition DetectLabels** finds reference objects (cars, wheels, trucks, people) with boxes, plus independent Flood and Water evidence. Boxes are drawn on the photo.
3. **Amazon Nova Pro** measures depth against known reference heights (wheel ~62 cm, knee ~45 cm, waist ~95 cm, door ~210 cm). Two parallel readings run and the deeper one wins. If Rekognition sees a flood that Nova misses, the safer reading is used.

YOLO and OpenCV on Lambda were considered and rejected: 200+ MB of dependencies and slow cold starts on flood night. The managed Rekognition service plus on-device MediaPipe avoids both.

## 4. How the AI coding agent built it (agent ↔ AWS)

I built BanjirSiap in about one day with **Claude** as my coding agent, **connected directly to my AWS account**. I made the decisions; the agent did the engineering.

1. **Planning.** The agent read the hackathon rules and judging criteria, proposed three ideas, and recommended BanjirSiap: local, timely (just before the monsoon), and strong on community impact.
2. **Building offline first.** It wrote the infrastructure-as-code (one SAM/CloudFormation template), the Python Lambda (rules engine + Bedrock prompts), and the four-language frontend. Before touching the cloud, it built a **local test harness** (moto-mocked DynamoDB + a fake Bedrock client) and drove every screen in headless Chromium to catch UI bugs.
3. **Connecting to AWS.** We first tried `aws login`. The agent found the real blocker from the AWS error page: my new account was on the Free plan, where Bedrock quotas are zero. After I upgraded (my free credits still pay first, and a zero-spend budget alert is set), I created a dedicated IAM user for the agent in CloudShell (to be deleted after judging). The agent configured the AWS CLI and verified it with `aws sts get-caller-identity`.
4. **Shipping.** Through the AWS CLI, the agent probed which Bedrock models my account could invoke (Nova Pro and Lite yes, Nova 2 still under account verification), packaged and deployed the CloudFormation stack, synced the site to S3, invalidated CloudFront, and ran live smoke tests.
5. **Debugging in production.** The agent ran the live app against real Bedrock output and fixed what it found:
   - The model sized water for **3 people in a 4-person household**. Fix: compute household size in code and pass it in as a hard fact.
   - In Tamil output, the alert level "Bahaya" was **transliterated wrongly**. Fix: official JPS level names are pinned in Latin script.
   - Triage told a **wheelchair user to "move upstairs"**. Fix: a deterministic escalation rule (mobility need + knee-deep water ⇒ "Call 999 / APM") that the AI cannot override.
   - The Lambda kept using the old model after a template change. Root cause: CloudFormation reuses previous parameter values. Fix: explicit parameter override in `deploy.sh`.
   - The sandbox's injected AWS environment variables were overriding the CLI profile. Fix: a clean-env wrapper.

**Proof screenshots:** `docs/screenshots/08-proof-agent-aws-cli.png` shows the agent's AWS CLI session (identity, Bedrock call, stack status and all 11 resources). The other screenshots show the live app.

## 5. Community and market impact

- **Who it serves:** about 33 million Malaysians across all four major language communities. The most important users are the elderly, the disabled, and low-income ground-floor households, who were the most affected in 2021.
- **Distribution that already exists:** every taman, flat and kampung already has a WhatsApp group and a residents' committee. BanjirSiap rides that network: one link, no app store.
- **Cost:** serverless means about **USD 0** when there's no flood. A busy flood night for a 200-household neighbourhood (about 400 check-ins, 50 triages, 100 photo checks) costs **a few US cents** in Bedrock and Lambda. A whole state's worth of residents' associations could run on a hobby budget.
- **Path to scale:** partner with state disaster committees and NGOs (for example, MERCY Malaysia, Malaysian Red Crescent) to pre-create groups for every flood-prone taman before November; add live JPS river-level triggers and push alerts; aggregate (anonymised) "need help" heatmaps for official responders.

## 6. What's next
- Pull live JPS river-level data to auto-switch each plan's stage (Waspada → Amaran → Bahaya)
- SMS / WhatsApp Business notifications to residents who haven't checked in
- Volunteer self-assignment ("I'll take Lim family") and boat/4x4 resource tracking
- An offline-first PWA, so plans open without signal

## 7. Try it
1. **Plan:** https://d1auxcg6lvocbo.cloudfront.net/#/plan → answer 6 questions → get your plan
2. **Demo board:** home page → "Try the live demo board" → press **AI triage**
3. **Check in as a resident:** from the demo board, open "Flood check-in" and submit "I need help". Watch it appear on the board.
4. **Photo:** https://d1auxcg6lvocbo.cloudfront.net/#/photo → upload any flood photo
5. Switch language at the top right: **English · Bahasa Melayu · 中文 · தமிழ்**

*BanjirSiap gives guidance, not official warnings. Always follow JPS, NADMA, APM, Bomba and police instructions.*

**Sources:** Wikipedia, "2021–2022 Malaysian floods"; DOSM Special Report on Impact of Floods in Malaysia 2021; ISEAS Perspective 2022/26.

#social-good #community #aws #amazon-bedrock #serverless #hackathon
