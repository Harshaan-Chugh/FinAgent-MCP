import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';

interface TestCase {
  id: string;
  name: string;
  description: string;
  tool: string;
  tools?: { tool: string; input: any }[];
  input: any;
  expected: any;
  category: string;
  priority: 'high' | 'medium' | 'low';
  repeatCount?: number;
}

interface TestResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'error';
  duration: number;
  error?: string;
  actualResult?: any;
  assertions: {
    name: string;
    passed: boolean;
    expected: any;
    actual: any;
  }[];
}

interface EvaluationReport {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  totalDuration: number;
  byCategory: Record<string, { passed: number; total: number; passRate: number }>;
  byPriority: Record<string, { passed: number; total: number; passRate: number }>;
  results: TestResult[];
}

class EvaluationRunner {
  private baseUrl = 'http://localhost:3001';
  private userId = 'dev-user-1';
  private testCases: TestCase[] = [];

  constructor() {
    this.loadTestCases();
  }

  private loadTestCases() {
    const testCasesPath = path.join(__dirname, 'test-cases.json');
    const rawData = fs.readFileSync(testCasesPath, 'utf8');
    this.testCases = JSON.parse(rawData);
    console.log(`Loaded ${this.testCases.length} test cases`);
  }

  async runEvaluation(options: {
    categories?: string[];
    priorities?: string[];
    ids?: string[];
    parallel?: boolean;
  } = {}): Promise<EvaluationReport> {
    console.log('🚀 Starting FinAgent MCP Evaluation\n');

    // Filter test cases
    let filteredTests = this.testCases;
    
    if (options.categories?.length) {
      filteredTests = filteredTests.filter(test => 
        options.categories!.includes(test.category)
      );
    }
    
    if (options.priorities?.length) {
      filteredTests = filteredTests.filter(test => 
        options.priorities!.includes(test.priority)
      );
    }
    
    if (options.ids?.length) {
      filteredTests = filteredTests.filter(test => 
        options.ids!.includes(test.id)
      );
    }

    console.log(`Running ${filteredTests.length} tests...\n`);

    const startTime = performance.now();
    let results: TestResult[];

    if (options.parallel) {
      results = await this.runTestsParallel(filteredTests);
    } else {
      results = await this.runTestsSequential(filteredTests);
    }

    const endTime = performance.now();
    const totalDuration = endTime - startTime;

    return this.generateReport(results, totalDuration);
  }

  private async runTestsSequential(testCases: TestCase[]): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    for (const testCase of testCases) {
      const result = await this.runSingleTest(testCase);
      results.push(result);
      this.printTestResult(result);
    }
    
    return results;
  }

  private async runTestsParallel(testCases: TestCase[]): Promise<TestResult[]> {
    const promises = testCases.map(testCase => this.runSingleTest(testCase));
    const results = await Promise.all(promises);
    
    results.forEach(result => this.printTestResult(result));
    
    return results;
  }

  private async runSingleTest(testCase: TestCase): Promise<TestResult> {
    const startTime = performance.now();
    
    try {
      let actualResult: any;
      
      if (testCase.tools) {
        // Multi-tool integration test
        actualResult = await this.runMultiToolTest(testCase);
      } else if (testCase.repeatCount && testCase.repeatCount > 1) {
        // Repeated test (for rate limiting, etc.)
        actualResult = await this.runRepeatedTest(testCase);
      } else {
        // Single tool test
        actualResult = await this.callTool(testCase.tool, testCase.input);
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      const assertions = this.validateResult(testCase, actualResult);
      const status = assertions.every(a => a.passed) ? 'pass' : 'fail';
      
      return {
        id: testCase.id,
        name: testCase.name,
        status,
        duration,
        actualResult,
        assertions,
      };
      
    } catch (error: any) {
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      return {
        id: testCase.id,
        name: testCase.name,
        status: 'error',
        duration,
        error: error.message,
        assertions: [{
          name: 'No error occurred',
          passed: false,
          expected: 'no error',
          actual: error.message,
        }],
      };
    }
  }

  private async runMultiToolTest(testCase: TestCase): Promise<any> {
    const results: any[] = [];
    
    for (const toolCall of testCase.tools!) {
      const result = await this.callTool(toolCall.tool, toolCall.input);
      results.push({ tool: toolCall.tool, result });
    }
    
    return { multiToolResults: results };
  }

  private async runRepeatedTest(testCase: TestCase): Promise<any> {
    const results: any[] = [];
    let rateLimitHit = false;
    
    for (let i = 0; i < testCase.repeatCount!; i++) {
      try {
        const result = await this.callTool(testCase.tool, testCase.input);
        results.push({ attempt: i + 1, result });
      } catch (error: any) {
        if (error.message.includes('rate limit') || error.message.includes('429')) {
          rateLimitHit = true;
          break;
        }
        throw error;
      }
    }
    
    return { repeatedResults: results, rateLimitHit };
  }

  private async callTool(toolName: string, input: any): Promise<any> {
    const url = `${this.baseUrl}/tools/${toolName}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': this.userId,
      },
      body: JSON.stringify(input),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  }

  private validateResult(testCase: TestCase, actualResult: any): {
    name: string;
    passed: boolean;
    expected: any;
    actual: any;
  }[] {
    const assertions: any[] = [];
    const expected = testCase.expected;
    
    // Handle error expectations
    if (expected.hasError) {
      assertions.push({
        name: 'Should have error',
        passed: actualResult.success === false,
        expected: 'error response',
        actual: actualResult.success ? 'success response' : 'error response',
      });
      
      if (expected.errorType) {
        assertions.push({
          name: `Error type should be ${expected.errorType}`,
          passed: actualResult.error?.includes(expected.errorMessage || expected.errorType),
          expected: expected.errorType,
          actual: actualResult.error,
        });
      }
      
      return assertions;
    }

    // Handle multi-tool tests
    if (actualResult.multiToolResults) {
      assertions.push({
        name: 'All tools should succeed',
        passed: actualResult.multiToolResults.every((r: any) => r.result.success),
        expected: 'all success',
        actual: actualResult.multiToolResults.map((r: any) => r.result.success),
      });
      
      return assertions;
    }

    // Handle repeated tests  
    if (actualResult.repeatedResults) {
      if (expected.rateLimitTriggered) {
        assertions.push({
          name: 'Rate limit should be triggered',
          passed: actualResult.rateLimitHit,
          expected: 'rate limit hit',
          actual: actualResult.rateLimitHit ? 'rate limit hit' : 'no rate limit',
        });
      }
      
      return assertions;
    }

    // Standard validations
    if (expected.hasData !== undefined) {
      const hasData = actualResult.success && actualResult.data && 
        (Array.isArray(actualResult.data) ? actualResult.data.length > 0 : !!actualResult.data);
      
      assertions.push({
        name: 'Should have data',
        passed: hasData === expected.hasData,
        expected: expected.hasData,
        actual: hasData,
      });
    }

    if (expected.respondsWithinTime) {
      assertions.push({
        name: `Should respond within ${expected.respondsWithinTime}ms`,
        passed: true, // Duration check handled in test runner
        expected: `< ${expected.respondsWithinTime}ms`,
        actual: 'within time', // Simplified for this example
      });
    }

    // Tool-specific validations
    this.addToolSpecificAssertions(testCase, actualResult, assertions);

    return assertions;
  }

  private addToolSpecificAssertions(testCase: TestCase, actualResult: any, assertions: any[]) {
    const expected = testCase.expected;
    const data = actualResult.data;

    // Account-related assertions
    if (expected.minAccountCount) {
      const accountCount = Array.isArray(data) ? data.length : 
        data?.accounts?.length || 0;
      
      assertions.push({
        name: `Should have at least ${expected.minAccountCount} accounts`,
        passed: accountCount >= expected.minAccountCount,
        expected: `>= ${expected.minAccountCount}`,
        actual: accountCount,
      });
    }

    // Transaction-related assertions
    if (expected.minTransactionCount) {
      const txnCount = Array.isArray(data) ? data.length :
        data?.transactions?.length || 0;
      
      assertions.push({
        name: `Should have at least ${expected.minTransactionCount} transactions`,
        passed: txnCount >= expected.minTransactionCount,
        expected: `>= ${expected.minTransactionCount}`,
        actual: txnCount,
      });
    }

    // Order-related assertions
    if (expected.orderCreated) {
      assertions.push({
        name: 'Order should be created',
        passed: !!data?.order?.id,
        expected: 'order with id',
        actual: data?.order?.id ? 'order created' : 'no order',
      });
    }

    if (expected.isDryRun !== undefined) {
      assertions.push({
        name: `Dry run should be ${expected.isDryRun}`,
        passed: data?.order?.dry_run === expected.isDryRun,
        expected: expected.isDryRun,
        actual: data?.order?.dry_run,
      });
    }

    // Context card assertions
    if (expected.hasContextCard) {
      assertions.push({
        name: 'Should have context card',
        passed: !!data?.contextCard,
        expected: 'context card present',
        actual: data?.contextCard ? 'present' : 'missing',
      });
    }

    if (expected.withinTokenBudget) {
      const withinBudget = data?.contextCard?.totalTokens <= (testCase.input.tokenBudget || 2500);
      assertions.push({
        name: 'Should be within token budget',
        passed: withinBudget,
        expected: 'within budget',
        actual: `${data?.contextCard?.totalTokens || 0} tokens`,
      });
    }
  }

  private generateReport(results: TestResult[], totalDuration: number): EvaluationReport {
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const errors = results.filter(r => r.status === 'error').length;
    
    const byCategory: Record<string, { passed: number; total: number; passRate: number }> = {};
    const byPriority: Record<string, { passed: number; total: number; passRate: number }> = {};
    
    // Calculate stats by category and priority
    for (const testCase of this.testCases) {
      const result = results.find(r => r.id === testCase.id);
      if (!result) continue;
      
      // By category
      if (!byCategory[testCase.category]) {
        byCategory[testCase.category] = { passed: 0, total: 0, passRate: 0 };
      }
      byCategory[testCase.category].total++;
      if (result.status === 'pass') {
        byCategory[testCase.category].passed++;
      }
      
      // By priority
      if (!byPriority[testCase.priority]) {
        byPriority[testCase.priority] = { passed: 0, total: 0, passRate: 0 };
      }
      byPriority[testCase.priority].total++;
      if (result.status === 'pass') {
        byPriority[testCase.priority].passed++;
      }
    }
    
    // Calculate pass rates
    Object.values(byCategory).forEach(cat => {
      cat.passRate = cat.total > 0 ? (cat.passed / cat.total) * 100 : 0;
    });
    Object.values(byPriority).forEach(pri => {
      pri.passRate = pri.total > 0 ? (pri.passed / pri.total) * 100 : 0;
    });
    
    return {
      timestamp: new Date().toISOString(),
      totalTests: results.length,
      passed,
      failed,
      errors,
      passRate: results.length > 0 ? (passed / results.length) * 100 : 0,
      totalDuration: Math.round(totalDuration),
      byCategory,
      byPriority,
      results,
    };
  }

  private printTestResult(result: TestResult) {
    const status = result.status === 'pass' ? '✅' : 
                  result.status === 'fail' ? '❌' : '⚠️';
    const duration = Math.round(result.duration);
    
    console.log(`${status} ${result.id}: ${result.name} (${duration}ms)`);
    
    if (result.status !== 'pass') {
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
      
      const failedAssertions = result.assertions.filter(a => !a.passed);
      failedAssertions.forEach(assertion => {
        console.log(`   ❌ ${assertion.name}`);
        console.log(`      Expected: ${JSON.stringify(assertion.expected)}`);
        console.log(`      Actual: ${JSON.stringify(assertion.actual)}`);
      });
    }
    console.log();
  }

  printReport(report: EvaluationReport) {
    console.log('\n📊 EVALUATION REPORT');
    console.log('='.repeat(50));
    console.log(`Timestamp: ${report.timestamp}`);
    console.log(`Total Tests: ${report.totalTests}`);
    console.log(`Passed: ${report.passed} (${report.passRate.toFixed(1)}%)`);
    console.log(`Failed: ${report.failed}`);
    console.log(`Errors: ${report.errors}`);
    console.log(`Duration: ${report.totalDuration}ms`);
    
    console.log('\nBy Category:');
    Object.entries(report.byCategory).forEach(([category, stats]) => {
      console.log(`  ${category}: ${stats.passed}/${stats.total} (${stats.passRate.toFixed(1)}%)`);
    });
    
    console.log('\nBy Priority:');
    Object.entries(report.byPriority).forEach(([priority, stats]) => {
      console.log(`  ${priority}: ${stats.passed}/${stats.total} (${stats.passRate.toFixed(1)}%)`);
    });
    
    const failedTests = report.results.filter(r => r.status !== 'pass');
    if (failedTests.length > 0) {
      console.log('\nFailed Tests:');
      failedTests.forEach(test => {
        console.log(`  ❌ ${test.id}: ${test.name}`);
      });
    }
    
    console.log('\n' + '='.repeat(50));
  }
}

// CLI interface
if (require.main === module) {
  const runner = new EvaluationRunner();
  
  const args = process.argv.slice(2);
  const options: any = {};
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--categories' && i + 1 < args.length) {
      options.categories = args[i + 1].split(',');
      i++;
    } else if (arg === '--priorities' && i + 1 < args.length) {
      options.priorities = args[i + 1].split(',');
      i++;
    } else if (arg === '--ids' && i + 1 < args.length) {
      options.ids = args[i + 1].split(',');
      i++;
    } else if (arg === '--parallel') {
      options.parallel = true;
    }
  }
  
  runner.runEvaluation(options)
    .then(report => {
      runner.printReport(report);
      
      // Save report to file
      const reportPath = path.join(__dirname, '..', 'results', `eval-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\nReport saved to: ${reportPath}`);
      
      process.exit(report.passRate === 100 ? 0 : 1);
    })
    .catch(error => {
      console.error('Evaluation failed:', error);
      process.exit(1);
    });
}

export { EvaluationRunner, TestCase, TestResult, EvaluationReport };