#!/usr/bin/env bash
# DCL boundary discipline check (CI-friendly).
#
# lib/dcl/ is the generic, domain- and infra-agnostic DCL core. It must contain NO
# Agent Studio / Web3 / document / infra vocabulary — all of that lives on the
# adapter side (lib/dcl-adapter.ts, lib/dcl-store-supabase.ts) which is INTENTIONALLY
# outside lib/dcl/ and therefore exempt from this check.
#
# This is the grep from DCL-v2-Phase1-SPEC.md section 5, with one refinement: it uses
# whole-word matching (-w) so it does not false-positive on innocent substrings such
# as "undefined"/"defines" (which contain "defi") while still catching a real "DeFi".
#
# Exit 0 (pass) when nothing is found; exit 1 (fail) when a forbidden term appears.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/lib/dcl"
PATTERN='web3|tokenomic|defi|audit|blockchain|proofflow|antlab|pdfshift|tech ?spec|supabase|anthropic|claude|opus|sonnet'

if grep -rwinE "$PATTERN" "$DIR"; then
  echo "DCL boundary violation: forbidden domain/infra vocabulary found in lib/dcl/ (see matches above)." >&2
  exit 1
fi

echo "DCL boundary check passed: lib/dcl/ is clean."
exit 0
