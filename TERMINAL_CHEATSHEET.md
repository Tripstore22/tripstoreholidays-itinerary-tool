# TripStore Terminal Cheat Sheet
*Keep this open whenever you're working. Copy-paste as needed.*

---

## 1. STARTING A SESSION

Open terminal, then type:
```
cd /Users/Sumit/Desktop/Itinerary-Create
claude
```
First message to Claude every time:
```
read SESSIONS.md and tell me where we left off
```
That's it. Claude will catch up silently and be ready.

---

## 2. MID SESSION — Every 1-2 Hours

When responses start feeling slow or less accurate, run this in the Claude chat (not terminal):
```
/compact
```
This compresses the conversation to save tokens without losing context.
You don't need to do anything else — just keep working after.

To check how many tokens you've used so far:
```
/tokens
```

---

## 3. CLOSING THE DAY

Run these in order — takes 2 minutes:

**Step 1 — Tell Claude you're done (auto-updates SESSIONS.md):**
```
bye
```
or
```
done for today
```

**Step 2 — Backup all conversations:**
```
bash /Users/Sumit/Desktop/Itinerary-Create/backup_chats.sh
```

**Step 3 — Clear the chat for next time:**
```
/clear
```

**Step 4 — Exit terminal:**
```
exit
```

---

## 4. CLOSING ONE TASK (mid-day, switching to something else)

**Tell Claude the task is done:**
```
this task is done, update sessions and we'll move to the next one
```

**Then compact to save tokens before starting the next task:**
```
/compact
```

---

## 5. STARTING A NEW TASK (same session)

After compacting, just describe what you want:
```
new task: [describe what you want to build]
```
Example:
```
new task: add a WhatsApp share button to the itinerary print page
```

If it's a completely fresh topic with no connection to what you just did:
```
/clear
```
Then start fresh with the SESSIONS.md read command from Section 1.

---

## 6. BACKUP — Run Anytime

Manual backup of all terminal conversations:
```
bash /Users/Sumit/Desktop/Itinerary-Create/backup_chats.sh
```

Check when last backup happened:
```
cat /Users/Sumit/Desktop/Itinerary-Create/chat_backups/last_backup.txt
```

Set up automatic daily backup at 9am (run this ONCE, never again):
```
(crontab -l 2>/dev/null; echo "0 9 * * * bash /Users/Sumit/Desktop/Itinerary-Create/backup_chats.sh") | crontab -
```

---

## 7. SESSIONS.MD — Read / Check / Update

Read what's pending:
```
cat /Users/Sumit/Desktop/Itinerary-Create/SESSIONS.md
```

Ask Claude to update it manually mid-session:
```
update sessions.md with what we've done so far
```

Ask Claude to find something from a past session:
```
search backup chats for when we discussed [topic]
```

---

## 8. PUSH CODE TO LIVE SITE

Claude does this automatically on every edit.
But if you ever need to push manually:

```
cd /Users/Sumit/Desktop/Itinerary-Create
git add index_fit.tripstore.html index.html
git commit -m "your description here"
git push origin v2
```

Check if live site is up to date:
```
git log --oneline -5
```

---

## 9. USEFUL ONE-LINERS

| What you want | Command |
|---|---|
| Open project folder | `cd /Users/Sumit/Desktop/Itinerary-Create` |
| Start Claude | `claude` |
| Check git status | `git status` |
| See recent changes | `git log --oneline -10` |
| Check live site branch | `git branch` |
| Run feature integrity check | `bash .git/hooks/pre-push` |
| See all saved HTML versions | `ls *.html` |
| Find something in code | `grep -n "what you're looking for" index_fit.tripstore.html` |

---

## 10. IF SOMETHING BREAKS

**If live site shows wrong version:**
```
git log --oneline -3
git push origin v2 --force
```

**If a feature goes missing:**
```
bash .git/hooks/pre-push
```
This will tell you exactly which feature is missing and block the push until it's fixed.

**If Claude seems confused about the project:**
```
/clear
```
Then start fresh — `claude` → `read SESSIONS.md and tell me where we left off`

---

## QUICK REFERENCE — Daily Flow

```
Morning:   cd project → claude → "read SESSIONS.md"
Every 2hr: /compact
New task:  "this task is done, update sessions" → /compact → describe next task
End of day: "bye" → backup script → /clear → exit
```

---
*Last updated: 2026-04-09*
