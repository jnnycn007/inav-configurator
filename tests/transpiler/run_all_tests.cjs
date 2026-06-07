#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testDir = __dirname;
const testFiles = fs.readdirSync(testDir)
  .filter(f => f.endsWith('.test.cjs'))
  .sort();

console.log('🧪 Running Full Transpiler Test Suite\n');

let passed = 0;
let failed = 0;
const failures = [];

for (const testFile of testFiles) {
  const testPath = path.join(testDir, testFile);
  const testName = testFile.replace('.test.cjs', '').replace(/_/g, ' ');

  process.stdout.write(`Testing ${testName}... `);

  try {
    execSync(`node "${testPath}"`, {
      stdio: 'pipe',
      cwd: testDir,
      encoding: 'utf-8'
    });
    console.log('✅');
    passed++;
  } catch (error) {
    console.log('❌');
    failed++;
    // simple_test_runner writes all output to stdout; use message as fallback for crashes
    failures.push({ test: testName, error: error.stdout || error.message });
  }
}

console.log('\n' + '='.repeat(60));
console.log('📊 Test Suite Results:');
console.log(`   Passed: ${passed}`);
console.log(`   Failed: ${failed}`);
console.log(`   Total:  ${passed + failed}`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\n❌ FAILURES:\n');
  for (const failure of failures) {
    console.log(`\n${failure.test}:`);
    console.log(failure.error.split('\n').slice(-20).join('\n'));
  }
  process.exit(1);
} else {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
}
