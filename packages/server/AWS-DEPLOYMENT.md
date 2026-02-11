# Deploy LineHeat Server to AWS

This guide shows the easiest ways to deploy the LineHeat server to AWS, from simplest to most production-ready.

## Quick Start: Docker on EC2 (Easiest)

### 1. Launch an EC2 Instance

```bash
# Using AWS CLI (configure your credentials first)
aws ec2 run-instances \
  --image-id ami-0c02fb55956c7d316 \
  --instance-type t3.micro \
  --key-name your-key-pair \
  --security-group-ids sg-xxxxxxxxx \
  --subnet-id subnet-xxxxxxxxx \
```

Or use the AWS Console:
- Choose **Amazon Linux 2023** or **Ubuntu 22.04+**
- Select **t3.micro** (free tier eligible)
- Configure security group to allow ports 22 (SSH) and 8787 (LineHeat)
- Attach your key pair

### 2. Deploy the Server

SSH into your instance and run:

```bash
# Install docker and git
# For Amazon Linux 2023
sudo yum update -y
sudo yum install -y docker git
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -a -G docker ec2-user

# For Ubuntu
sudo apt update
sudo apt install -y docker.io git
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -a -G docker ubuntu

# Log out and back in for group changes to take effect

# Generate SSH key on EC2
ssh-keygen -t ed25519 -C "your-email@example.com" -f ~/.ssh/github_deploy_key

# Display public key
cat ~/.ssh/github_deploy_key.pub

# Add this public key to your GitHub repo:
#  Go to your repo → Settings → Deploy keys → Add deploy key
#  Paste the public key, give it read access

# Create/edit ~/.ssh/config
cat > ~/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    IdentityFile ~/.ssh/github_deploy_key
    StrictHostKeyChecking no
EOF

chmod 600 ~/.ssh/config


# Clone and build
git clone https://github.com/your-org/line-heat.git
cd line-heat

# Build and run the Docker container
docker build -t lineheat-server -f packages/server/Dockerfile .

# Run with persistent data
mkdir -p ./data
docker run -d \
  --name lineheat-server \
  --restart unless-stopped \
  -e LINEHEAT_TOKEN=your-secure-token-here \
  -e LINEHEAT_RETENTION_DAYS=7 \
  -e LINEHEAT_DB_PATH=/data/lineheat.sqlite \
  -v ./data:/data \
  -p 127.0.0.1:3000:8787 \
  lineheat-server
```

**Note:** We bind Docker to `127.0.0.1:3000` (localhost only) so it's not directly accessible from the internet. Nginx will handle SSL and proxy requests to it.


### 3. Configure Security Group

In AWS Console, edit your security group to allow:
- **Port 8787** from your team's IP ranges (or 0.0.0.0/0 for public access)
- **80** (HTTP - for Let's Encrypt)
- **Port 22** for SSH access

Your LineHeat server is now available at `http://YOUR_EC2_IP:8787`

### 4. Set Up HTTPS with Nginx

**Create Nginx configuration (temporary, for certificate):**
```bash
sudo tee /etc/nginx/conf.d/lineheat.conf > /dev/null << 'EOF'
server {
    listen 80;
    server_name api.yourdomain.com;
    
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    location / {
        return 200 "Server is running, SSL setup in progress";
        add_header Content-Type text/plain;
    }
}
EOF

# Create webroot directory
sudo mkdir -p /var/www/html

# Test and start Nginx
sudo nginx -t
sudo systemctl start nginx
sudo systemctl enable nginx
```

**Get SSL certificate from Let's Encrypt:**
```bash
sudo certbot certonly --webroot -w /var/www/html -d api.yourdomain.com
```

Follow the prompts (enter email, agree to terms).

**Update Nginx configuration with SSL:**
```bash
sudo tee /etc/nginx/conf.d/lineheat.conf > /dev/null << 'EOF'
server {
    listen 8787 ssl;
    http2 on;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Keep port 80 open for certificate renewal
server {
    listen 80;
    server_name api.yourdomain.com;
    
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    location / {
        return 301 https://$host:8787$request_uri;
    }
}
EOF

# Reload Nginx
sudo nginx -t
sudo systemctl reload nginx
```

**SSL Certificate Auto-Renewal:**

Let's Encrypt certificates expire every 90 days. Certbot automatically sets up a renewal cron job. Test it:
```bash
sudo certbot renew --dry-run
```

### Upgrading running server

1. SSH into the EC2 instance
2. Pull latest code and rebuild Docker image
```bash
cd line-heat
git pull origin main
docker build -t lineheat-server -f packages/server/Dockerfile .
```
3. Restart the container (do not forget to provide correct environment variables)
```bash
docker stop lineheat-server
docker rm lineheat-server
docker run -d \
  --name lineheat-server \
  --restart unless-stopped \
  -e LINEHEAT_TOKEN=XXXXX \
  -e LINEHEAT_RETENTION_DAYS=7 \
  -e LINEHEAT_DB_PATH=/data/lineheat.sqlite \
  -v ./data:/data \
  -p 127.0.0.1:3000:8787 \
  lineheat-server
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LINEHEAT_TOKEN` | Yes | - | Authentication token for clients |
| `PORT` | No | 8787 | Server port |
| `LINEHEAT_RETENTION_DAYS` | No | 7 | Days to keep activity data |
| `LINEHEAT_DB_PATH` | No | `/data/lineheat.sqlite` | SQLite database location |
| `LOG_LEVEL` | No | `info` | Logging level (debug, info, warn, error) |

### Security Recommendations

1. **Use HTTPS** in production with Application Load Balancer or CloudFront
2. **Restrict IP ranges** in security groups to your team/office
3. **Use AWS Secrets Manager** for sensitive tokens
4. **Enable VPC Flow Logs** for monitoring
5. **Set up CloudWatch alarms** for CPU/memory usage

### Scaling Considerations

- **SQLite** limits you to one container (single-writer database)
- For horizontal scaling, consider migrating to PostgreSQL or MySQL
- Use **Application Load Balancer** with sticky sessions for multiple containers
- **Fargate Spot** can reduce costs for non-critical workloads

---

## Monitoring and Maintenance

### CloudWatch Monitoring

```bash
# Create CloudWatch log group
aws logs create-log-group --log-group-name /ecs/lineheat-server

# Set retention
aws logs put-retention-policy --log-group-name /ecs/lineheat-server --retention-in-days 14
```

### Backup Strategy for SQLite

```bash
# Add to your Docker container or ECS task
# Create daily backup script
cat > backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d)
sqlite3 /data/lineheat.sqlite ".backup /data/backups/lineheat-$DATE.sqlite"
# Keep only last 7 days
find /data/backups -name "lineheat-*.sqlite" -mtime +7 -delete
EOF

# Add to cron
echo "0 2 * * * /backup.sh" | crontab -
```

---

## Cost Optimization

| Option | Monthly Cost (approx) | Best For |
|--------|---------------------|-----------|
| EC2 t3.micro | $8-15 | Small teams, development |
| ECS Fargate | $20-50 | Production, moderate traffic |
| App Runner | $25-60 | Serverless, variable traffic |

*Costs vary by region and usage*

---

## Troubleshooting

### Common Issues

**Container won't start:**
```bash
# Check logs
docker logs lineheat-server
```

**Connection refused:**
- Check security group allows port 8787
- Verify LINEHEAT_TOKEN matches between server and clients
- Check if container is healthy

**Database errors:**
- Ensure volume mount is persistent
- Check disk space usage
- Verify SQLite file permissions

### Health Check

Add to your Docker container:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8787/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"
```

---

## Next Steps

1. **Set up monitoring** with CloudWatch alarms
2. **Configure backup strategy** for your SQLite database
3. **Consider database migration** if you need horizontal scaling
4. **Set up CI/CD** for automated deployments
5. **Implement proper SSL/TLS** with Certificate Manager

For questions about the LineHeat server protocol and implementation, see the [Protocol Reference](./README.md).