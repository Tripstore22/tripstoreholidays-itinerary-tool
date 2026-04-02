#!/bin/bash
# Daily backup of Claude Code conversation history
# Files are overwritten each run — always contains the latest copy

SOURCE="/Users/Sumit/.claude/projects/-Users-Sumit-Desktop-Itinerary-Create"
DEST="/Users/Sumit/Desktop/Itinerary-Create/chat_backups"

mkdir -p "$DEST"
cp -rf "$SOURCE/." "$DEST/"

echo "Backup done: $(date '+%Y-%m-%d %H:%M')" > "$DEST/last_backup.txt"
