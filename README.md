# RMetS AI panel live voting

Small Node.js voting app for the RMetS AI in meteorology panel.

## Local run

```bash
npm start
```

Audience page: <http://localhost:8787/>

Presenter dashboard: <http://localhost:8787/presenter.html>

Full-screen result page for a poll:

```text
/result.html?poll=poll-01
```

## Hosted deploy

Use Render as a Node Web Service. The included `render.yaml` defines:

- Node web service
- persistent disk mounted at `/var/data`
- `DATA_DIR=/var/data`
- private `ADMIN_TOKEN` field

Set a long random `ADMIN_TOKEN` in Render before using the presenter dashboard.

See `DEPLOY_RENDER.txt` for the Friday setup checklist.
