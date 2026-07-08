RMetS live voting app

What this is

A small local voting app for the AI in meteorology panel. It lets the audience vote on phones while you control the active poll and see results from a presenter dashboard.

Why local

GitHub Pages can host static files, but it cannot safely collect anonymous votes by itself. This app includes a tiny Node.js server so votes have somewhere to go. You can keep the source in GitHub, but run the server on the presentation laptop or another reachable machine.

Hosted option

For an auditorium, the hosted option is safer than a laptop-local server. See DEPLOY_RENDER.txt. A public hosted URL avoids venue Wi-Fi device isolation because phones connect to the internet, not directly to your laptop.

Run it

Quick way on Windows:

1. Double-click start-voting-app.bat.
2. If Windows Firewall asks about Node.js, choose Allow.
3. Keep the black terminal window open.
4. Open the presenter dashboard on the laptop:
   http://localhost:8787/presenter.html
5. Audience phones join using one of the IP URLs printed by the launcher:
   http://YOUR-LAPTOP-IP:8787/

Terminal way:

node server.mjs --host 0.0.0.0 --port 8787

Event tips

Use the same network for the laptop and audience phones. If venue Wi-Fi blocks device-to-device traffic, use Slido or Mentimeter instead.

Do a five-minute venue test before the session: start the app, connect one phone to the same Wi-Fi, open the audience URL, submit a test vote, and confirm it appears on the presenter dashboard. Then reset the test poll.

Use deck slide 3 for the join URL/QR. The live poll order and prompt slides are listed in ../rmets-ai-panel-poll-register.csv.

Votes are stored in data/votes.json while the server is running. Use the presenter dashboard reset buttons for rehearsal.
