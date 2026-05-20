# aic
aic podcast metrics and podcast episode data

## Server deployment

The web app is currently served on **port `8087`** on the shared farm host.

To deploy updates from this repo to the server in one command, run:

```bash
REMOTE_HOST=farm \
REMOTE_USER=ammonsfarm \
REMOTE_DIR=/mnt/storage/aic \
REMOTE_BRANCH=main \
REMOTE_SERVICE=aic-web.service \
REMOTE_PORT=8087 \
./scripts/deploy-farm-web.sh
```

After deploy, validate with:

```bash
ssh ammonsfarm@farm "curl -I http://127.0.0.1:8087/"
```

For Cloudflare Zero Trust, point the tunnel to `http://127.0.0.1:8087` (or `http://192.168.1.141:8087` from your network edge path).
