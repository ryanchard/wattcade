# KICKR probe — Milestone 0

Run this BEFORE trusting the game against real hardware.

    npm --workspace @paperboy/ble-probe run dev

Open http://localhost:5180 in **Chrome or Edge** (Safari and Firefox have no
Web Bluetooth). Close Zwift and the Wahoo app first — a trainer pairs to one
client at a time. Wake the trainer by pedalling, then press Connect.

Record the answers:

1. Does the device chooser list the KICKR?
   If it is empty: check Zwift/Wahoo are closed, and that Chrome has
   Bluetooth permission in macOS System Settings > Privacy & Security.
2. Does the log say `Control point present: true`?
3. Does `Request Control` say GRANTED?

If the answers to 2 and 3 are both yes, click **Run grade sweep**. Stay pedalling
steadily and note where the effort changes. The sweep takes about 48 seconds and
steps through grades of 0, 2, 4, 6, 3, 0, -3, and 0 percent — you should feel
clear resistance changes at 4% and 6%.

4. **During the grade sweep, does pedalling effort actually change at 4% and
   6%?** This is the question the whole milestone exists to answer.
5. Do the decoded power and cadence match what the Wahoo app shows for the
   same effort?

Then ride 60+ seconds with varied effort, press **Download capture**, and
commit the file:

    mkdir -p packages/trainer/test/fixtures
    cp ~/Downloads/kickr-capture.json packages/trainer/test/fixtures/kickr-capture.json

That activates a test which is skipped until the file exists — it replays
every recorded frame through the parser and asserts the decoded values are
physically plausible. It is how we find out whether the parser, written
against the spec, agrees with what this firmware actually sends.

If the answer to question 4 is **no**, the game still works: it degrades to
read-only arcade tuning, and terrain becomes visual rather than felt.

## If you close the tab mid-sweep

The page tries to reset resistance to 0% when you leave, but this is best-effort
only. A Bluetooth write takes time, and closing the tab may tear down the page
before it finishes — so resistance could stay where it was, for example at 6%.

If this happens, reopen this page, reconnect, and click **Run grade sweep** again.
The sweep ends by resetting to 0%, so this will clear the stuck resistance.
