#!/usr/bin/env node
/**
 * Check Playwright JSON report for skipped tests
 * Exits with error code 1 if any tests were skipped
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const REPORT_PATH = join(process.cwd(), 'test-results.json')

function main() {
  if (!existsSync(REPORT_PATH)) {
    console.error(`ERROR: Playwright JSON report not found at ${REPORT_PATH}`)
    console.error('Make sure to run: npm run test:e2e:ci')
    process.exit(1)
  }

  const report = JSON.parse(readFileSync(REPORT_PATH, 'utf-8'))

  // Playwright JSON report structure has suites with specs
  let skipped = 0
  let passed = 0
  let failed = 0
  const skippedTests = []

  function countTests(suites) {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          const status = test.status || test.results?.[0]?.status
          if (status === 'skipped') {
            skipped++
            skippedTests.push(`${suite.title} > ${spec.title}`)
          } else if (status === 'passed' || status === 'expected') {
            passed++
          } else if (status === 'failed' || status === 'unexpected') {
            failed++
          }
        }
      }
      // Recurse into nested suites
      if (suite.suites) {
        countTests(suite.suites)
      }
    }
  }

  countTests(report.suites)

  console.log(`E2E Test Results:`)
  console.log(`  Passed:  ${passed}`)
  console.log(`  Failed:  ${failed}`)
  console.log(`  Skipped: ${skipped}`)

  if (skipped > 0) {
    console.error(`\nERROR: ${skipped} test(s) were skipped:`)
    for (const test of skippedTests) {
      console.error(`  - ${test}`)
    }
    console.error(`\nSkipped tests are not allowed in CI. Fix the tests or remove them.`)
    process.exit(1)
  }

  if (failed > 0) {
    console.error(`\nERROR: ${failed} test(s) failed.`)
    process.exit(1)
  }

  console.log(`\nAll E2E tests passed with no skips!`)
  process.exit(0)
}

main()
