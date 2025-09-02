#!/usr/bin/env bash
set -euo pipefail

# 一键启动脚本（Linux/macOS）
# 功能：
# 1) 检查 Node 与 npm
# 2) 安装依赖（会触发 postinstall 的 install.js）
# 3) 生成 .env（若不存在，则从 .env.example 复制）
# 4) 创建 uploads 与 log 目录
# 5) 启动服务（生产模式）

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

info()  { echo -e "\033[32m[INFO]\033[0m $*"; }
warn()  { echo -e "\033[33m[WARN]\033[0m $*"; }
error() { echo -e "\033[31m[ERR ]\033[0m $*"; }

info "项目目录: $SCRIPT_DIR"

# 1) 检查 Node 与 npm
if ! command -v node >/dev/null 2>&1; then
  error "未检测到 Node.js，请先安装 Node.js (>=14)"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  error "未检测到 npm，请先安装 npm"
  exit 1
fi

NODE_VER="$(node -v || true)"
info "Node.js: $NODE_VER"
NPM_VER="$(npm -v || true)"
info "npm: $NPM_VER"

# 2) 安装依赖
info "安装依赖（首次运行时间可能较长）..."
# 如存在国内镜像需求，可自行取消注释：
# npm config set registry https://registry.npmmirror.com
npm install

# 3) 生成 .env（若不存在）
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    info "未发现 .env，正在从 .env.example 生成..."
    cp .env.example .env
  else
    warn ".env.example 不存在，跳过 .env 生成"
  fi
else
  info ".env 已存在，跳过生成"
fi

# 4) 创建目录
mkdir -p uploads log
info "已确保目录存在：uploads/ 与 log/"

# 5) 启动服务（前台运行）
export NODE_ENV=production
PORT_VAL="${PORT:-3000}"
info "以生产模式启动服务，端口: ${PORT_VAL}"
info "启动后请在浏览器访问: http://localhost:${PORT_VAL}/tutor_email_system.html"

exec node email_server.js