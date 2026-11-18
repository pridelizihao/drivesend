#!/usr/bin/env bash
# Deploy DriveSend to a remote host over SSH.
#
#   DEPLOY_HOST=root@your-server ./deploy.sh
#
# Optional:
#   DEPLOY_PATH     remote install directory (default /opt/drivesend)
#   DEPLOY_SERVICE  systemd unit name       (default drivesend)
set -eo pipefail

if [ -z "$DEPLOY_HOST" ]; then
  echo "usage: DEPLOY_HOST=root@your-server ./deploy.sh" >&2
  exit 1
fi

DIR="$DEPLOY_PATH"
if [ -z "$DIR" ]; then DIR=/opt/drivesend; fi
SVC="$DEPLOY_SERVICE"
if [ -z "$SVC" ]; then SVC=drivesend; fi

tar --exclude=./data --exclude=./.tools --exclude=./.git --exclude=./dist --exclude=./node_modules \
    -czf /tmp/drivesend.tgz .

ssh "$DEPLOY_HOST" "set -e
  mkdir -p $DIR
  cat > /tmp/drivesend.tgz
  rm -rf $DIR/src $DIR/web $DIR/test
  tar xzf /tmp/drivesend.tgz -C $DIR
  systemctl restart $SVC
  sleep 2
  systemctl is-active $SVC"

echo "deployed to $DEPLOY_HOST:$DIR"
