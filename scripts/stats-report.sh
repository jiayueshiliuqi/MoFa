#!/usr/bin/env bash
# MoFa 使用统计报告（纯 shell 实现，服务器上无需安装 Node.js）
#
# 用法：
#   bash scripts/stats-report.sh                                  # 默认读 /var/log/nginx/access.log
#   bash scripts/stats-report.sh /var/log/nginx/mofa-stats.log    # 指定日志
#   zcat /var/log/nginx/access.log*.gz | bash scripts/stats-report.sh -   # 读标准输入
#
# 依赖：grep / awk / sort / uniq / date（Linux 自带，无需安装）

set -uo pipefail

SRC="${1:-/var/log/nginx/access.log}"
D=$(mktemp -d 2>/dev/null || mktemp -d -t mofa)
trap 'rm -rf "$D"' EXIT

# 支持从标准输入读取（便于管道处理压缩日志）
if [ "$SRC" = "-" ]; then
  cat > "$D/access.log"
  LOG="$D/access.log"
else
  if [ ! -f "$SRC" ]; then
    echo "找不到日志文件：$SRC" >&2
    echo "提示：nginx 默认日志在 /var/log/nginx/access.log" >&2
    exit 1
  fi
  LOG="$SRC"
fi

# 当天日期（按 nginx 日志里的英文月份格式，强制 C locale 以避免中文月份名）
TODAY=$(LC_ALL=C date +%d/%b/%Y)
LAST7="$D/last7.txt"
for i in 0 1 2 3 4 5 6; do LC_ALL=C date -d "-$i day" +"[%d/%b/%Y:"; done > "$LAST7"

n() { wc -l < "$1" | tr -d ' '; }
ids_of() { grep -oE 'id=[A-Za-z0-9._-]+' "$1" 2>/dev/null | cut -d= -f2 | sort -u | wc -l | tr -d ' '; }
param_of() { grep -oE "[?&]$1=[^& ]+" "$2" 2>/dev/null | cut -d= -f2 | sort | uniq -c | sort -rn; }

# ---- 采集 ----
grep -E '"GET [^"]*\.apk ' "$LOG" 2>/dev/null | grep -E '" (200|206) ' > "$D/apk.txt" || true
# 注意：模式不以 / 开头，避免 Git Bash(MSYS) 把参数当路径转换
grep -F 'stats/hit' "$LOG" > "$D/hits.txt" 2>/dev/null || true
grep -F -f "$LAST7" "$D/hits.txt" > "$D/hits7.txt" 2>/dev/null || true
grep -F "[$TODAY:" "$D/hits.txt" > "$D/hits_today.txt" 2>/dev/null || true
grep -F "[$TODAY:" "$D/apk.txt" > "$D/apk_today.txt" 2>/dev/null || true

echo ""
echo "════════ MoFa 统计报告 ════════"
echo ""

echo "【APK 下载】"
APK_TOTAL=$(n "$D/apk.txt")
if [ "$APK_TOTAL" = "0" ]; then
  echo "  未发现下载记录"
else
  echo "  总下载次数：$APK_TOTAL"
  echo "  独立 IP 数：$(awk '{print $1}' "$D/apk.txt" | sort -u | wc -l | tr -d ' ')"
  echo "  按文件："
  grep -oE '[^/"]*\.apk' "$D/apk.txt" | sort | uniq -c | sort -rn | \
    awk '{printf "    %-28s %s 次\n", $2, $1}'
  echo "  今日下载：$(n "$D/apk_today.txt") 次"
fi

echo ""
echo "【使用人数（启动上报）】"
HITS_TOTAL=$(n "$D/hits.txt")
if [ "$HITS_TOTAL" = "0" ]; then
  echo "  未发现上报记录"
  echo "  排查：确认 App 已升级到带统计的版本，或 nginx 是否记录了 /stats/hit 请求"
else
  echo "  累计安装数（唯一 ID）：$(ids_of "$D/hits.txt")"
  echo "  今日活跃：$(ids_of "$D/hits_today.txt") 人"
  echo "  近 7 日活跃：$(ids_of "$D/hits7.txt") 人"
  echo "  总启动次数：$HITS_TOTAL 次"
  echo "  平台分布："
  param_of 'p' "$D/hits.txt" | awk '{printf "    %-16s %s 次启动\n", $2, $1}'
  echo "  版本分布："
  param_of 'v' "$D/hits.txt" | awk '{printf "    %-16s %s 次启动\n", $2, $1}'
fi

echo ""
echo "提示：本脚本也可读标准输入 —— zcat /var/log/nginx/access.log*.gz | bash $0 -"
echo "      想要图形化面板可安装 goaccess，或直接看 nginx 日志："
echo "      tail -f $LOG"
echo ""
