# 02: Mock auth and Principal sessions

**What to build:** A login screen offering the four customer accounts (Northstar Logistics, LumenWorks, Beacon Retail, Axis Labs) and a ParcelPilot staff persona. Choosing one issues a signed session whose payload is a Principal — customer-with-account-id or staff-with-role. The chat API requires a valid session; the UI shows who you are signed in as and offers sign-out/switch. From this ticket on, every request carries a Principal and unauthenticated requests are rejected.

Authentication is mocked by design (per the assessment) but the session must be tamper-proof (signed), because all later access-control guarantees hang off the Principal being trustworthy.

**Blocked by:** 01 (Walking skeleton on Cloudflare).
**Status:** done

- [x] A visitor must pick a persona before chatting; the chat API rejects requests without a valid session
- [x] The session is signed/verified server-side; a forged or altered session token is rejected
- [x] The Principal (customer + account id, or staff + role) is available to all downstream handlers as a typed value
- [x] The UI displays the active persona and supports switching personas
- [x] Tests at the API boundary cover: no session rejected, valid customer session accepted, valid staff session accepted, tampered token rejected

## Comments
Signed HMAC session (payload.sig, SHA-256) issuing Principal customer/staff. /api/auth/* for login/me/personas, /api/chat gated. UI persona picker + Switch, token in localStorage + Authorization header. 12 tests green. Deployed to workers.dev verified — unauth 401, valid session streams, tampered 401.
