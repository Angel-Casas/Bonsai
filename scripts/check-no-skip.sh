#!/bin/bash
# Check for .skip, .only, describe.skip, test.skip, it.skip patterns in test files
# Exit with error if any are found (except conditional test.skip() which are allowed)

set -e

echo "Checking for skipped/focused tests in unit tests..."

# Check unit tests (src/**/*.test.ts) for hard-coded skips
# We look for patterns like: describe.skip, it.skip, test.skip at the start of a statement
# (not conditional skips inside test bodies)
UNIT_SKIPS=$(grep -rn --include="*.test.ts" -E "^\s*(describe|it|test)\.skip\s*\(" src/ 2>/dev/null || true)
UNIT_ONLY=$(grep -rn --include="*.test.ts" -E "\.(only)\s*\(" src/ 2>/dev/null || true)

if [ -n "$UNIT_SKIPS" ]; then
  echo "ERROR: Found .skip in unit tests:"
  echo "$UNIT_SKIPS"
  exit 1
fi

if [ -n "$UNIT_ONLY" ]; then
  echo "ERROR: Found .only in unit tests:"
  echo "$UNIT_ONLY"
  exit 1
fi

echo "No skipped or focused unit tests found."
echo ""
echo "Checking for hard-coded skips in E2E tests..."

# For E2E tests, we allow conditional test.skip() inside test bodies
# but not at the describe/test definition level
# Hard-coded skips look like: test.skip('name', ...) or describe.skip('name', ...)
# Conditional skips inside bodies look like: test.skip() with no arguments - these are OK
E2E_SKIPS=$(grep -rn --include="*.spec.ts" -E "^\s*(describe|test)\.skip\s*\(['\"]" e2e/ 2>/dev/null || true)
E2E_ONLY=$(grep -rn --include="*.spec.ts" -E "\.(only)\s*\(" e2e/ 2>/dev/null || true)

if [ -n "$E2E_SKIPS" ]; then
  echo "ERROR: Found hard-coded .skip in E2E tests:"
  echo "$E2E_SKIPS"
  exit 1
fi

if [ -n "$E2E_ONLY" ]; then
  echo "ERROR: Found .only in E2E tests:"
  echo "$E2E_ONLY"
  exit 1
fi

echo "No hard-coded skipped or focused E2E tests found."
echo "All checks passed!"
