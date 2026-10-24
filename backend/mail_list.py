#!/usr/bin/python3
"""AuroraPanel mailing lists — Postfix pipes each message for a list address here
(as the vmail user): list.py <list-address> <envelope-sender>.

Checks who may post, adds the standard list headers (List-Id, List-Post,
List-Unsubscribe, Precedence), optionally prefixes the subject, sets Reply-To and
rewrites From for senders whose domain would fail DMARC, then re-sends one copy
to every member through the local sendmail. Standard library only.
"""
import email
import email.policy
import email.utils
import json
import subprocess
import sys

CONF = "/etc/aurora-mail/lists.json"
EX_NOPERM, EX_TEMPFAIL, EX_DATAERR = 77, 75, 65


def main() -> int:
    if len(sys.argv) < 3:
        return EX_DATAERR
    listaddr, sender = sys.argv[1].lower(), sys.argv[2].lower()
    try:
        with open(CONF, encoding="utf-8") as f:
            lists = json.load(f)
    except (OSError, ValueError):
        return EX_TEMPFAIL
    cfg = lists.get(listaddr)
    if not cfg:
        print(f"{listaddr} is not a mailing list", file=sys.stderr)
        return EX_NOPERM
    raw = sys.stdin.buffer.read()
    msg = email.message_from_bytes(raw, policy=email.policy.compat32)
    # Never answer bounces or loop our own posts back in.
    if not sender or sender.startswith("mailer-daemon") or msg.get("X-Aurora-List", "").lower() == listaddr:
        return 0
    from_addr = email.utils.parseaddr(msg.get("From", ""))[1].lower()
    members = [m.lower() for m in cfg.get("members", [])]
    owners = [o.lower() for o in cfg.get("owners", [])]
    poster = {from_addr, sender}
    access = cfg.get("access", "members")
    if access == "members" and not poster & set(members + owners):
        print(f"Only members of {listaddr} may post to it.", file=sys.stderr)
        return EX_NOPERM
    if access == "announce" and not poster & set(owners):
        print(f"{listaddr} is an announcement list; only its owners may post.", file=sys.stderr)
        return EX_NOPERM
    name, domain = listaddr.split("@")
    del msg["X-Aurora-List"]
    msg["X-Aurora-List"] = listaddr
    for h in ("List-Id", "List-Post", "List-Unsubscribe", "List-Help", "Precedence", "List-Owner"):
        del msg[h]
    desc = (cfg.get("description") or name).replace('"', "'")
    msg["List-Id"] = f'"{desc}" <{name}.{domain}>'
    msg["List-Post"] = f"<mailto:{listaddr}>"
    owner = (cfg.get("owners") or [f"postmaster@{domain}"])[0]
    msg["List-Owner"] = f"<mailto:{owner}>"
    msg["List-Unsubscribe"] = f"<mailto:{owner}?subject=unsubscribe%20{listaddr}>"
    msg["Precedence"] = "list"
    if cfg.get("prefix", True):
        subj = msg.get("Subject", "")
        tag = f"[{name}]"
        if tag.lower() not in str(subj).lower():
            del msg["Subject"]
            msg["Subject"] = f"{tag} {subj}".strip()
    original_from = msg.get("From", "")
    if cfg.get("munge_from", True) and from_addr and not from_addr.endswith("@" + domain):
        # Re-sending someone else's From: breaks DMARC at Gmail/Yahoo/Outlook; send "as" the list instead.
        display = email.utils.parseaddr(original_from)[0] or from_addr
        del msg["From"]
        msg["From"] = email.utils.formataddr((f"{display} via {name}", listaddr))
        if not cfg.get("reply_to_list", True):
            del msg["Reply-To"]
            msg["Reply-To"] = original_from
    if cfg.get("reply_to_list", True):
        del msg["Reply-To"]
        msg["Reply-To"] = listaddr
    # Signatures from the original sender no longer match after our changes.
    del msg["DKIM-Signature"]
    rcpts = sorted(set(members) - {listaddr})
    if not rcpts:
        return 0
    data = msg.as_bytes()
    for i in range(0, len(rcpts), 50):
        r = subprocess.run(["/usr/sbin/sendmail", "-i", "-f", listaddr, "--", *rcpts[i:i + 50]], input=data,
                           capture_output=True, timeout=120)
        if r.returncode != 0:
            print(r.stderr.decode(errors="replace")[-300:], file=sys.stderr)
            return EX_TEMPFAIL
    return 0


if __name__ == "__main__":
    sys.exit(main())
