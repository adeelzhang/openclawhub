#!/bin/bash
# OpenClawZoo 一键部署脚本
# 用法: ./deploy.sh
set -e

SERVER="root@156.226.175.218"
APP="openclawhub"

echo "[1/4] git push..."
git add -A && git diff --cached --quiet || git commit -m "deploy: $(date '+%Y-%m-%d %H:%M')" && git push

echo "[2/4] 远程 pull + build..."
ssh $SERVER "cd /root/$APP && git pull && docker build --network=host -t $APP:latest ."

echo "[3/4] 重启容器..."
ssh $SERVER "docker rm -f $APP && docker run -d --name $APP --restart unless-stopped -p 3721:3721 -v /root/$APP/logs:/app/logs $APP:latest"

echo "[4/4] 验证..."
sleep 2
status=$(curl -s -o /dev/null -w '%{http_code}' https://www.openclawzoo.com)
echo "HTTP $status"
[ "$status" = "200" ] && echo "✅ 部署成功" || echo "❌ 请检查服务"
