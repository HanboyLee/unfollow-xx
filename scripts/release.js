#!/usr/bin/env node

/**
 * X Unfollower - 自动发布脚本
 *
 * 功能：
 * - 自动更新版本号
 * - 更新 manifest.json
 * - 创建 Git commit
 * - 创建 Git tag
 * - 推送到远程仓库（触发 GitHub Actions Release）
 *
 * 使用方法：
 *   npm run release          # 交互式选择版本类型
 *   npm run release:patch    # 1.0.0 -> 1.0.1
 *   npm run release:minor    # 1.0.0 -> 1.1.0
 *   npm run release:major    # 1.0.0 -> 2.0.0
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import * as readline from 'readline';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
};

// 读取 package.json
function readPackage() {
  const content = readFileSync('package.json', 'utf-8');
  return JSON.parse(content);
}

// 写入 package.json
function writePackage(pkg) {
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
}

// 读取 manifest.json
function readManifest() {
  const content = readFileSync('manifest.json', 'utf-8');
  return JSON.parse(content);
}

// 写入 manifest.json
function writeManifest(manifest) {
  writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}

// 解析版本号
function parseVersion(version) {
  const parts = version.split('.').map(Number);
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

// 格式化版本号
function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

// 增加版本号
function bumpVersion(version, type) {
  const v = parseVersion(version);

  switch (type) {
    case 'major':
      v.major++;
      v.minor = 0;
      v.patch = 0;
      break;
    case 'minor':
      v.minor++;
      v.patch = 0;
      break;
    case 'patch':
      v.patch++;
      break;
    default:
      throw new Error(`Invalid version type: ${type}`);
  }

  return formatVersion(v);
}

// 执行命令
function exec(cmd, dryRun = false) {
  if (dryRun) {
    log.info(`[DRY RUN] ${cmd}`);
    return;
  }
  execSync(cmd, { stdio: 'inherit' });
}

// 询问用户
async function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// 显示版本变更
function showVersionChange(current, next) {
  console.log('\n' + '='.repeat(50));
  console.log(`  ${colors.yellow}版本变更${colors.reset}`);
  console.log('='.repeat(50));
  console.log(`  当前版本: ${colors.yellow}${current}${colors.reset}`);
  console.log(`  新版本:   ${colors.green}${next}${colors.reset}`);
  console.log('='.repeat(50) + '\n');
}

// 主函数
async function main() {
  log.info('X Unfollower - 自动发布脚本\n');

  // 检查工作目录是否干净
  try {
    execSync('git diff --quiet HEAD 2>&1');
  } catch {
    log.error('工作目录有未提交的更改，请先提交或暂存。');
    process.exit(1);
  }

  // 获取当前版本
  const pkg = readPackage();
  const currentVersion = pkg.version;
  log.info(`当前版本: ${currentVersion}`);

  // 确定版本类型
  let versionType = process.argv[2];

  if (!versionType) {
    log.info('\n请选择版本类型:');
    console.log('  1) patch  - 修复 Bug (1.0.0 -> 1.0.1)');
    console.log('  2) minor  - 新功能 (1.0.0 -> 1.1.0)');
    console.log('  3) major  - 破坏性变更 (1.0.0 -> 2.0.0)');

    const answer = await askQuestion('\n请输入选项 (1-3): ');

    const options = { '1': 'patch', '2': 'minor', '3': 'major' };
    versionType = options[answer];

    if (!versionType) {
      log.error('无效的选项');
      process.exit(1);
    }
  }

  // 计算新版本
  const nextVersion = bumpVersion(currentVersion, versionType);
  showVersionChange(currentVersion, nextVersion);

  // 确认发布
  const confirm = await askQuestion(`确认发布版本 ${nextVersion}? (y/N): `);

  if (confirm.toLowerCase() !== 'y') {
    log.warn('发布已取消');
    process.exit(0);
  }

  // 更新 package.json
  pkg.version = nextVersion;
  writePackage(pkg);
  log.success('package.json 已更新');

  // 更新 manifest.json
  const manifest = readManifest();
  manifest.version = nextVersion;
  writeManifest(manifest);
  log.success('manifest.json 已更新');

  // Git 提交
  const tagName = `v${nextVersion}`;
  exec('git add package.json manifest.json');
  exec(`git commit -m "chore: release ${tagName}"`);
  log.success('Git 提交完成');

  // 创建 tag
  exec(`git tag -a ${tagName} -m "Release ${tagName}"`);
  log.success(`Git tag ${tagName} 已创建`);

  // 推送到远程
  log.info('推送到远程仓库...');
  exec('git push');
  exec(`git push origin ${tagName}`);
  log.success('推送完成');

  console.log('\n' + '='.repeat(50));
  log.success(`发布完成！版本 ${nextVersion}`);
  console.log('='.repeat(50));
  console.log(`\nGitHub Actions 将自动构建并创建 Release:`);
  console.log(`  ${colors.blue}https://github.com/HanboyLee/unfollow-xx/releases${colors.reset}\n`);
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
