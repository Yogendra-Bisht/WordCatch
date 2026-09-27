# WordCatch — Deployment Guide

> This guide covers every step to take WordCatch from local dev to production.
> Three deployment paths: **Simple VPS**, **Docker**, and **AWS**.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Pre-Deployment Checklist](#2-pre-deployment-checklist)
3. [Environment Variables Reference](#3-environment-variables-reference)
4. [Option A — Simple VPS (Ubuntu + nginx + PM2)](#4-option-a--simple-vps-ubuntu--nginx--pm2)
5. [Option B — Docker (Recommended for Learning)](#5-option-b--docker-recommended-for-learning)
6. [Option C — AWS Deployment](#6-option-c--aws-deployment)
7. [Database — MongoDB Atlas](#7-database--mongodb-atlas)
8. [SSL / HTTPS with Lets Encrypt](#8-ssl--https-with-lets-encrypt)
9. [Chrome Extension — Production Build and Publishing](#9-chrome-extension--production-build-and-publishing)
10. [CI/CD with GitHub Actions](#10-cicd-with-github-actions)
11. [Monitoring and Logs](#11-monitoring-and-logs)
12. [Rollback Strategy](#12-rollback-strategy)
13. [Cost Comparison and Which Option to Choose](#13-cost-comparison-and-which-option-to-choose)

---

## 1. Architecture Overview

```
+--------------------------------------------------------------+
|                      USER'S BROWSER                          |
|                                                              |
|  +--------------------------------------------------------+  |
|  |               Chrome Extension (MV3)                   |  |
|  | content-script.js  <->  service-worker.js  <-> popup  |  |
|  +---------------------------|----------------------------+  |
|                              | HTTPS                        |
+------------------------------|------------------------------+
                               |
                   +-----------v-----------+
                   |   nginx (reverse      |
                   |   proxy + TLS)        |
                   |   Port 80 / 443       |
                   +-----------|-----------+
                               |
                   +-----------v-----------+
                   |  Node.js / Express    |
                   |  WordCatch API        |
                   |  Port 3000            |
                   +-----------|-----------+
                               |
             +-----------------+-----------------+
             |                 |                 |
  +----------v------+  +-------v----+  +---------v-------+
  | MongoDB Atlas   |  | Free Dict  |  |  Datamuse API   |
  | (Cloud DB)      |  | API        |  |  (Fallback)     |
  +-----------------+  +------------+  +-----------------+
```

**What you deploy:**
- `backend/` — Node.js API server (runs on a server/cloud)
- `extension/` — Chrome extension (distributed via Chrome Web Store, runs in users browser)

---

## 2. Pre-Deployment Checklist

### 2.1 Update `host_permissions` in the extension

The extension currently only allows `http://localhost:3000/*`. For production update it to your domain:

```json
// extension/manifest.json
"host_permissions": [
  "https://api.yourdomain.com/*"
]
```

### 2.2 Update `API_BASE` in the service worker

```js
// extension/background/service-worker.js  — line 1
const API_BASE = 'https://api.yourdomain.com';  // change from localhost
```

### 2.3 Create production `.env`

```bash
NODE_ENV=production
PORT=3000
MONGO_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/wordcatch
JWT_SECRET=<64-char-random-string>
EXTENSION_ORIGIN=chrome-extension://<your-extension-id>
```

> **NEVER commit `.env` to Git.** Make sure `.env*` is in `.gitignore`.

### 2.4 Generate a strong JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 3. Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | Set to `production` in prod |
| `PORT` | No | `3000` | Port the Express server listens on |
| `MONGO_URI` | Yes | `mongodb://localhost/wordcatch` | MongoDB connection string |
| `JWT_SECRET` | Yes | crashes if missing in prod | Secret for signing/verifying JWTs |
| `EXTENSION_ORIGIN` | No | `*` (all) | Lock CORS to your specific extension only |

---

## 4. Option A — Simple VPS (Ubuntu + nginx + PM2)

**Best for:** Getting started, full control, cheapest option (~$4-6/month on DigitalOcean or Linode).

### Step 1 — Get a VPS

- Sign up on **DigitalOcean**, **Linode**, or **Vultr**
- Create an **Ubuntu 22.04** droplet — 1 GB RAM is enough
- Add your SSH public key during setup

### Step 2 — Connect and secure the server

```bash
ssh root@YOUR_SERVER_IP

# Create a non-root user
adduser wordcatch
usermod -aG sudo wordcatch
su - wordcatch
```

### Step 3 — Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should show v20+
```

### Step 4 — Clone repo and install dependencies

```bash
cd ~
git clone https://github.com/Yogendra-Bisht/WordCatch.git
cd WordCatch/backend
npm install --omit=dev      # production deps only
```

### Step 5 — Create the `.env` file

```bash
nano .env       # paste your production env vars, Ctrl+X -> Y -> Enter to save
```

### Step 6 — Install PM2 (keeps your app alive)

PM2 restarts your app after crashes and after server reboots.

```bash
sudo npm install -g pm2

# Start the app
pm2 start src/index.js --name wordcatch-api

# Save process list and enable auto-start on reboot
pm2 startup systemd     # run the command it prints
pm2 save
```

Useful PM2 commands:
```bash
pm2 status                  # see all running processes
pm2 logs wordcatch-api      # live logs
pm2 restart wordcatch-api   # restart after code change
pm2 monit                   # real-time CPU/memory dashboard
```

### Step 7 — Install and configure nginx

```bash
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/wordcatch
```

Paste:
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/wordcatch /etc/nginx/sites-enabled/
sudo nginx -t           # must say "syntax is ok"
sudo systemctl reload nginx
```

Then add HTTPS — see **Section 8**.

---

## 5. Option B — Docker (Recommended for Learning)

Docker packages your app and all its dependencies into an isolated, portable container.
Run the same container locally, on any VPS, or any cloud without changing anything.

### 5.1 Install Docker

```bash
# Ubuntu
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable docker --now
sudo usermod -aG docker $USER   # re-login after this
```

On Windows/Mac: install [Docker Desktop](https://www.docker.com/products/docker-desktop/).

### 5.2 Create `backend/Dockerfile`

```dockerfile
# ── Stage 1: install dependencies ─────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: lean production image ────────────────────────────────
FROM node:20-alpine

# Run as non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health | grep -q '"ok":true' || exit 1

CMD ["node", "src/index.js"]
```

### 5.3 Create `backend/.dockerignore`

```
node_modules
.env*
__tests__
*.test.js
.git
*.md
```

### 5.4 Create `docker-compose.yml` at the project root

```yaml
version: '3.9'

services:
  mongo:
    image: mongo:7.0
    restart: unless-stopped
    volumes:
      - mongo_data:/data/db
    networks:
      - wordcatch-net

  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      MONGO_URI: mongodb://mongo:27017/wordcatch
      JWT_SECRET: ${JWT_SECRET}
      EXTENSION_ORIGIN: ${EXTENSION_ORIGIN}
    depends_on:
      - mongo
    networks:
      - wordcatch-net

volumes:
  mongo_data:

networks:
  wordcatch-net:
    driver: bridge
```

### 5.5 Run with Docker Compose

```bash
# Create a .env at the project root with your secrets
echo "JWT_SECRET=your-64-char-secret" > .env
echo "EXTENSION_ORIGIN=chrome-extension://your-extension-id" >> .env

# Build images and start all containers in background
docker compose up -d --build

# Check status
docker compose ps

# View live API logs
docker compose logs -f api

# Stop everything
docker compose down
```

### 5.6 Docker concepts you learn here

| Concept | What it does in this project |
|---|---|
| **Image** | Blueprint built from `Dockerfile` |
| **Container** | A running instance of the image |
| **Volume** | Persistent MongoDB data storage that survives container restarts |
| **Network** | Private network so `api` reaches `mongo` by hostname |
| **Compose** | Orchestrates multiple containers as a single application |
| **Multi-stage build** | Builder stage installs deps; final image only contains what is needed — smaller and faster |

---

## 6. Option C — AWS Deployment

### 6.1 AWS EC2 — Virtual Machine (Like a VPS but on AWS)

EC2 gives you a virtual machine on AWS. Follow **Option A** steps exactly — the process is identical.

```
AWS Console -> EC2 -> Launch Instance
  OS: Ubuntu 22.04 LTS
  Instance type: t3.micro (free tier eligible for 12 months)
  Security group: open ports 22, 80, 443
```

After launching:
```bash
ssh -i your-key.pem ubuntu@your-ec2-public-ip
# Then follow Option A steps 3-7 exactly
```

Assign an **Elastic IP** (static public IP) so the address does not change on reboot:
```
AWS Console -> EC2 -> Elastic IPs -> Allocate -> Associate with instance
```

**Pros:** Full control, familiar, cheap (~$8/month).
**Cons:** You manage OS updates, security patches yourself.

---

### 6.2 AWS Elastic Beanstalk — Easiest AWS Option

Elastic Beanstalk manages EC2, load balancer, and auto-scaling for you. You only upload code.

```bash
# Install EB CLI
pip install awsebcli

cd backend

# Initialize — choose Node.js 20 platform
eb init wordcatch-api --platform "Node.js 20" --region ap-south-1

# Create environment (provisions EC2 + auto-scaling group)
eb create wordcatch-production

# Set env vars on the EB environment
eb setenv \
  NODE_ENV=production \
  JWT_SECRET=your-secret \
  MONGO_URI=your-atlas-uri \
  EXTENSION_ORIGIN=chrome-extension://your-id

# Deploy latest code
eb deploy

# Open in browser to verify
eb open

# Stream logs
eb logs
```

Create `backend/Procfile` to tell EB how to start:
```
web: node src/index.js
```

**Pros:** Automatic scaling, health checks, rolling deploys — zero server management.
**Cons:** Slightly more expensive, less control.

---

### 6.3 AWS ECS with Fargate — Professional Containerized Deployment

ECS runs Docker containers serverlessly. You push an image; AWS runs it. No servers to manage.

**Step 1 — Push your Docker image to ECR (AWS private registry)**

```bash
# Configure AWS CLI with your credentials
aws configure

# Create the ECR repository
aws ecr create-repository --repository-name wordcatch-api --region ap-south-1

# Log Docker into ECR
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS --password-stdin \
    YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com

# Build, tag, and push
docker build -t wordcatch-api ./backend
docker tag wordcatch-api:latest \
  YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/wordcatch-api:latest
docker push \
  YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/wordcatch-api:latest
```

**Step 2 — Create ECS Cluster and Service (AWS Console)**

1. ECS -> Clusters -> Create Cluster -> AWS Fargate (serverless)
2. Task Definitions -> Create New:
   - Image URI: your ECR image URL
   - Container port: 3000
   - CPU: 0.25 vCPU, Memory: 512 MB (cheapest)
   - Add environment variables (or inject from Secrets Manager)
3. Services -> Create -> link task definition, set desired tasks = 1
4. Add an Application Load Balancer targeting port 3000

**Step 3 — Store secrets securely with AWS Secrets Manager**

```bash
aws secretsmanager create-secret \
  --name wordcatch/production \
  --secret-string '{"JWT_SECRET":"your-secret","MONGO_URI":"your-atlas-uri"}'
```

Reference secrets in the ECS task definition instead of hardcoding them.

**AWS services used in this setup:**

| Service | Purpose |
|---|---|
| **ECR** | Private Docker image registry |
| **ECS Fargate** | Runs containers without you managing servers |
| **ALB** | Routes HTTPS traffic to your containers |
| **ACM** | Free TLS/SSL certificates attached to ALB |
| **Secrets Manager** | Stores JWT secret and DB password securely |
| **CloudWatch** | Container logs and monitoring alarms |

---

## 7. Database — MongoDB Atlas

MongoDB Atlas is the recommended database for all options above.
It is fully managed (no maintenance), has automatic backups, and a free tier.

### Setup Steps

1. Create account at [cloud.mongodb.com](https://cloud.mongodb.com)
2. New Project -> Build a Cluster -> **M0 Free Tier**
3. Pick a region close to your server (e.g., `ap-south-1` for India)
4. **Database Access** -> Add database user:
   - Username: `wordcatch`
   - Password: strong auto-generated password
   - Role: `readWriteAnyDatabase`
5. **Network Access** -> Add your server IP address (or `0.0.0.0/0` temporarily)
6. **Connect** -> **Connect your application** -> Copy the URI:

```
mongodb+srv://wordcatch:<password>@cluster0.xxxxx.mongodb.net/wordcatch?retryWrites=true&w=majority
```

Use this string as your `MONGO_URI` environment variable.

### Free Tier vs Paid

| | M0 Free | M2 Paid |
|---|---|---|
| Storage | 512 MB | 2 GB |
| RAM | Shared | 1 GB |
| Price | $0/month | ~$9/month |

512 MB is sufficient for thousands of users on WordCatch.

---

## 8. SSL / HTTPS with Lets Encrypt

HTTPS is **required** — the Chrome extension cannot make requests to `http://` URLs in production.

### VPS or EC2 with nginx

```bash
sudo apt install certbot python3-certbot-nginx -y

# Get free certificate and auto-configure nginx
sudo certbot --nginx -d api.yourdomain.com

# Test that auto-renewal works
sudo certbot renew --dry-run
```

Certbot automatically edits your nginx config, sets up HTTPS, and renews every 90 days.

### AWS with ALB (Application Load Balancer)

1. **ACM** -> Request a public certificate -> enter `api.yourdomain.com`
2. Choose DNS validation -> add the CNAME record in your DNS provider
3. Wait a few minutes for validation to complete
4. In ALB: Listeners -> Add listener -> HTTPS 443 -> attach the ACM certificate
5. ALB handles TLS termination; your Node.js app stays on HTTP port 3000 internally

---

## 9. Chrome Extension — Production Build and Publishing

### 9.1 Update for production

**`extension/background/service-worker.js` line 1:**
```js
const API_BASE = 'https://api.yourdomain.com';   // replace localhost
```

**`extension/manifest.json`:**
```json
"host_permissions": [
  "https://api.yourdomain.com/*"
],
"version": "1.0.1"     // bump version for each release
```

### 9.2 Package as ZIP

```powershell
# Windows PowerShell
Compress-Archive -Path d:\WordCatch\extension\* -DestinationPath wordcatch-v1.0.0.zip
```

```bash
# Linux / Mac
zip -r wordcatch-v1.0.0.zip extension/ --exclude "*.git*"
```

### 9.3 Publish to Chrome Web Store

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard)
2. Pay the **one-time $5 developer registration fee**
3. Click **Add new item** -> upload your ZIP
4. Fill in the store listing:
   - **Name:** WordCatch
   - **Category:** Productivity
   - **Description:** Double-click any word to look it up and build your personal vocabulary list
   - **Screenshots:** At least one 1280x800 or 640x400 screenshot
   - **Privacy policy URL:** required — host a simple page on GitHub Pages
5. Submit for review — takes 1 to 3 business days

### 9.4 Lock down CORS with your Extension ID

After publishing you get a permanent Extension ID like `abcdefghijklmnopqrstuvwxyzabcdef`.
Set this on your backend:

```
EXTENSION_ORIGIN=chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef
```

This restricts your API to only accept requests from your extension.

---

## 10. CI/CD with GitHub Actions

Automatic deploy to your server every time you push to `main`, but only if all tests pass.

Create `.github/workflows/deploy.yml`:

```yaml
name: Test and Deploy

on:
  push:
    branches: [main]
    paths:
      - 'backend/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json

      - name: Install
        run: npm ci
        working-directory: backend

      - name: Test
        run: npm test
        working-directory: backend
        env:
          NODE_ENV: test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # ── Option A: Deploy to VPS via SSH ─────────────────────────
      - name: SSH Deploy
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ~/WordCatch/backend
            git pull origin main
            npm install --omit=dev
            pm2 restart wordcatch-api

      # ── Option B: AWS ECS (uncomment to use) ────────────────────
      # - name: Configure AWS
      #   uses: aws-actions/configure-aws-credentials@v4
      #   with:
      #     aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
      #     aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      #     aws-region: ap-south-1
      #
      # - name: Build and push to ECR
      #   run: |
      #     aws ecr get-login-password | docker login --username AWS --password-stdin ${{ secrets.ECR_REGISTRY }}
      #     docker build -t ${{ secrets.ECR_REGISTRY }}/wordcatch-api:${{ github.sha }} ./backend
      #     docker push ${{ secrets.ECR_REGISTRY }}/wordcatch-api:${{ github.sha }}
      #
      # - name: Force ECS redeploy
      #   run: aws ecs update-service --cluster wordcatch --service wordcatch-api --force-new-deployment
```

**Secrets to add in GitHub** (Settings -> Secrets and variables -> Actions):

| Secret | What to put |
|---|---|
| `VPS_HOST` | Your server IP or domain |
| `VPS_USER` | `wordcatch` (non-root user) |
| `VPS_SSH_KEY` | Full contents of your private SSH key file |
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `ECR_REGISTRY` | `YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com` |

---

## 11. Monitoring and Logs

### PM2 (VPS)

```bash
pm2 monit                  # live CPU and memory per process
pm2 logs wordcatch-api     # stream logs
pm2 logs --lines 200       # last 200 log lines
```

### Docker

```bash
docker compose logs -f api  # follow API container logs
docker stats                # live resource usage for all containers
```

### AWS CloudWatch

- ECS and Elastic Beanstalk stream container stdout automatically
- AWS Console -> CloudWatch -> Log groups -> `/ecs/wordcatch-api`
- Create an **Alarm** on 5xx errors or CPU > 80% to get email alerts

### Health Endpoint

Your app exposes `/health`:

```bash
curl https://api.yourdomain.com/health
# {"ok":true,"process":"up","database":"connected","timestamp":"..."}
```

Set up free uptime monitoring on [UptimeRobot](https://uptimerobot.com):
- Monitor type: HTTPS
- URL: `https://api.yourdomain.com/health`
- Check interval: 5 minutes
- Alert: email or Telegram when down

---

## 12. Rollback Strategy

### VPS with PM2

```bash
cd ~/WordCatch/backend
git log --oneline -10           # find the last known-good commit
git checkout <commit-hash>
pm2 restart wordcatch-api
```

### Docker

```bash
# Tag every deploy with a git SHA
# e.g. wordcatch-api:abc1234

# To roll back:
docker compose down
# Edit docker-compose.yml: change image tag to previous SHA
docker compose up -d
```

### AWS ECS

```bash
# ECS keeps every task definition revision
# Roll back to the previous one:
aws ecs update-service \
  --cluster wordcatch \
  --service wordcatch-api \
  --task-definition wordcatch-api:PREVIOUS_REVISION_NUMBER
```

---

## 13. Cost Comparison and Which Option to Choose

### Cost Table

| Hosting Setup | Est. Monthly Cost |
|---|---|
| DigitalOcean 1GB Droplet + MongoDB Atlas Free | ~$6 |
| AWS EC2 t3.micro + Atlas Free | ~$8 (free for first 12 months with AWS Free Tier) |
| AWS Elastic Beanstalk + Atlas Free | ~$10 |
| AWS ECS Fargate 0.25vCPU/512MB + Atlas M2 | ~$15-20 |
| Railway.app Starter | $5 flat |
| Render.com Individual | Free (spins down after inactivity) |

### Which Option to Choose

| Your Situation | Best Option |
|---|---|
| Just starting out, want it simple | **Option A — VPS with PM2** |
| Learning Docker (highly recommended!) | **Option B — Docker Compose on a VPS** |
| Learning AWS | **Option C6.1 — EC2** first, then move to ECS when comfortable |
| Want managed AWS with least effort | **Option C6.2 — Elastic Beanstalk** |
| Production-grade, container-native | **Option C6.3 — ECS Fargate** |
| Completely free to start | **Render.com** (free tier) or **Railway.app** |

> **Recommended learning path:**
> Local -> Docker locally -> Docker on VPS -> AWS EC2 -> AWS ECS Fargate
> Each step teaches you something new without being overwhelming.

---

*WordCatch DEPLOYMENT.md — v1.0.0 — September 2026*
