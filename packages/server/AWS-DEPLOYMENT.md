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
  --user-data "$(cat <<EOF
#!/bin/bash
apt-get update
apt-get install -y docker.io
systemctl start docker
systemctl enable docker
usermod -aG docker ubuntu
EOF
)"
```

Or use the AWS Console:
- Choose **Amazon Linux 2023** or **Ubuntu 22.04+**
- Select **t3.micro** (free tier eligible)
- Configure security group to allow ports 22 (SSH) and 8787 (LineHeat)
- Attach your key pair

### 2. Deploy the Server

SSH into your instance and run:

```bash
# Clone and build
git clone https://github.com/your-org/line-heat.git
cd line-heat

# Build and run the Docker container
docker build -t lineheat-server -f packages/server/Dockerfile .

# Run with persistent data
mkdir -p /data
docker run -d \
  --name lineheat-server \
  --restart unless-stopped \
  -e LINEHEAT_TOKEN=your-secure-token-here \
  -e LINEHEAT_RETENTION_DAYS=7 \
  -e LINEHEAT_DB_PATH=/data/lineheat.sqlite \
  -v /data:/data \
  -p 8787:8787 \
  lineheat-server
```

### 3. Configure Security Group

In AWS Console, edit your security group to allow:
- **Port 8787** from your team's IP ranges (or 0.0.0.0/0 for public access)
- **Port 22** for SSH access

Your LineHeat server is now available at `http://YOUR_EC2_IP:8787`

---

## Production Option: ECS with Fargate

For production use, ECS provides better scaling, monitoring, and managed infrastructure.

### 1. Create ECR Repository

```bash
aws ecr create-repository --repository-name lineheat-server

# Authenticate Docker with ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker build -t lineheat-server -f packages/server/Dockerfile .
docker tag lineheat-server:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/lineheat-server:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/lineheat-server:latest
```

### 2. Create ECS Task Definition

Save as `ecs-task-definition.json`:

```json
{
  "family": "lineheat-server",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::<account-id>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "lineheat-server",
      "image": "<account-id>.dkr.ecr.us-east-1.amazonaws.com/lineheat-server:latest",
      "portMappings": [
        {
          "containerPort": 8787,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "LINEHEAT_TOKEN",
          "value": "your-secure-token-here"
        },
        {
          "name": "LINEHEAT_RETENTION_DAYS",
          "value": "7"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/lineheat-server",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### 3. Create ECS Service

```bash
# Create task definition
aws ecs register-task-definition --cli-input-json file://ecs-task-definition.json

# Create service
aws ecs create-service \
  --cluster lineheat-cluster \
  --service-name lineheat-server \
  --task-definition lineheat-server \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxxxxxxx],securityGroups=[sg-xxxxxxxxx],assignPublicIp=ENABLED}"
```

---

## Advanced Option: App Runner

For a fully managed serverless experience:

### 1. Build and Push Container

Same as ECS steps above, but use App Runner:

```bash
aws apprunner create-service \
  --service-name lineheat-server \
  --source-configuration "ImageRepository={ImageIdentifier=<account-id>.dkr.ecr.us-east-1.amazonaws.com/lineheat-server:latest,ImageRepositoryType=ECR,AutoDeploymentsEnabled=true},AutoDeploymentsEnabled=true" \
  --instance-configuration Cpu=256 Memory=512 \
  --port 8787 \
  --environment-variables "Key=LINEHEAT_TOKEN,Value=your-secure-token-here,Key=LINEHEAT_RETENTION_DAYS,Value=7"
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
# or for ECS
aws logs get-log-events --log-group-name /ecs/lineheat-server --log-stream-prefix ecs
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