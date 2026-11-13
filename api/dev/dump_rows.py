"""Turn a PostgreSQL-flavoured multi-row INSERT dump into one MySQL INSERT per row.

Rows that are cut off or have unbalanced quotes (the person dump has a few) are skipped
and counted on stderr, so one bad row doesn't abort the whole table.
Usage: python3 -I dump_rows.py [--pg] FILE...  > out.sql
  --pg  emit PostgreSQL instead (double-quoted identifiers, ON CONFLICT DO NOTHING).
"""
import re
import sys

HEADER = re.compile(r'^INSERT INTO "([^"]+)" \(([^)]*)\) VALUES')
ROW_START = re.compile(r"^\s*\(\d+, ")


def balanced(row):
    # Count quotes, treating '' (escaped quote) as a pair.
    return row.replace("''", "").count("'") % 2 == 0


def main(paths, pg=False):
    skipped = 0
    for path in paths:
        header = None
        buf = None  # a row whose quoted value spans several lines
        with open(path, encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                line = raw.rstrip("\r\n")
                if buf is None:
                    stripped = line.strip()
                    m = HEADER.match(stripped)
                    if m:
                        names = [c.strip().strip('"') for c in m.group(2).split(",")]
                        if pg:
                            header = 'INSERT INTO "%s" (%s) OVERRIDING SYSTEM VALUE VALUES ' % (
                                m.group(1), ", ".join('"%s"' % c for c in names))
                        else:
                            header = "INSERT IGNORE INTO `%s` (%s) VALUES " % (
                                m.group(1), ", ".join("`%s`" % c for c in names))
                        continue
                    if not header or not stripped.startswith("("):
                        continue
                    buf = stripped
                elif ROW_START.match(line):
                    # The open row was cut off mid-value (e.g. person id 21); drop it, start the next.
                    skipped += 1
                    buf = line.strip()
                else:
                    buf += "\n" + line
                if not balanced(buf):
                    if len(buf) > 20000:  # runaway quote: give up on this row
                        skipped += 1
                        buf = None
                    continue
                row = buf.rstrip().rstrip(";").rstrip(",")
                buf = None
                if not row.endswith(")"):
                    skipped += 1
                    continue
                if pg:
                    print(header + row + " ON CONFLICT DO NOTHING;")
                else:
                    print(header + row.replace("\\", "\\\\") + ";")
    print("skipped %d broken rows" % skipped, file=sys.stderr)


if __name__ == "__main__":
    args = sys.argv[1:]
    main([a for a in args if a != "--pg"], pg="--pg" in args)
