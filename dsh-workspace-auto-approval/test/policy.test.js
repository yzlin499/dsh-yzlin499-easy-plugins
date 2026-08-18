import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyCommand, classifyToolCall, isClearlyReadOnlyCommand, isInsideWorkspace } from '../policy.js'

const workspace = process.platform === 'win32' ? 'C:\\work\\project' : '/work/project'
const outside = process.platform === 'win32' ? 'C:\\Users\\someone\\notes.txt' : '/home/someone/notes.txt'

test('recognizes workspace containment without prefix confusion', () => {
  assert.equal(isInsideWorkspace(workspace, workspace), true)
  assert.equal(isInsideWorkspace(`${workspace}${process.platform === 'win32' ? '\\src\\a.js' : '/src/a.js'}`, workspace), true)
  assert.equal(isInsideWorkspace(`${workspace}-other`, workspace), false)
})

test('allows mutating file tools only inside the workspace', () => {
  assert.equal(classifyToolCall({ toolName: 'write', args: { file_path: `${workspace}${process.platform === 'win32' ? '\\a.txt' : '/a.txt'}` }, workspaceRoot: workspace }).decision, 'allow')
  assert.equal(classifyToolCall({ toolName: 'edit', args: { file_path: outside }, workspaceRoot: workspace }).decision, 'human')
})

test('allows read-only commands even when they read outside', () => {
  assert.equal(isClearlyReadOnlyCommand(`Get-Content "${outside}"`), true)
  assert.equal(classifyCommand({ command: `Get-Content "${outside}"`, workdir: workspace, workspaceRoot: workspace }).decision, 'allow')
  assert.equal(classifyCommand({ command: 'curl.exe -s https://example.com/data.json', workdir: workspace, workspaceRoot: workspace }).decision, 'allow')
})

test('sends workspace shell writes to AI instead of trusting text-only containment', () => {
  assert.equal(classifyCommand({ command: 'Remove-Item .\\build -Recurse', workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: 'Get-ChildItem .\\build | Remove-Item -Force', workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: 'Set-Content .\\out\\pwn.txt x', workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: 'Set-Content $HOME\\pwn.txt x', workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
})

test('sends otherwise unknown workspace commands to AI review', () => {
  assert.equal(classifyCommand({ command: 'pnpm test', workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
})

test('does not auto-allow write-capable forms of read commands', () => {
  assert.equal(classifyCommand({ command: 'find . -delete', workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: 'git branch new-name', workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: `git diff --output="${outside}"`, workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: 'curl -dsecret https://example.com', workdir: workspace, workspaceRoot: workspace }).decision, 'human')
  assert.equal(classifyCommand({ command: 'curl --request=POST https://example.com', workdir: workspace, workspaceRoot: workspace }).decision, 'human')
  assert.equal(classifyCommand({ command: 'curl -K ./post.cfg', workdir: workspace, workspaceRoot: workspace }).decision, 'human')
  assert.equal(classifyCommand({ command: 'curl --json "{}" https://example.com', workdir: workspace, workspaceRoot: workspace }).decision, 'human')
  assert.equal(classifyCommand({ command: `sort -o${outside}`, workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: `Sort-Object { Remove-Item "${outside}" -Force }`, workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: `Invoke-WebRequest https://example.com -OutF "${outside}"`, workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: 'git diff', workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
})

test('resolves relative workdirs and file targets from the workspace root', () => {
  assert.equal(classifyCommand({ command: 'Remove-Item target.txt', workdir: '../outside', workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyToolCall({ toolName: 'write', args: { file_path: '../outside.txt' }, workspaceRoot: workspace }).decision, 'human')
})

test('does not auto-allow host changes or uploads', () => {
  assert.equal(classifyCommand({ command: 'Set-Service sshd -StartupType Automatic', workdir: workspace, workspaceRoot: workspace }).decision, 'human')
  assert.equal(classifyCommand({ command: 'curl.exe -X POST -d @data.json https://example.com', workdir: workspace, workspaceRoot: workspace }).decision, 'human')
})

test('does not treat nested execution or redirection as a plain read', () => {
  assert.equal(classifyCommand({ command: 'Write-Output $(Remove-Item ..\\outside.txt)', workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: `Write-Output (Remove-Item "${outside}" -Force)`, workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: 'cat /etc/hosts & rm -f /tmp/victim', workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: `Get-Content "${outside}" > "${outside}.copy"`, workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
})

test('sends ambiguous external and dynamic paths to AI review', () => {
  const parentWrite = process.platform === 'win32' ? 'Set-Content ..\\outside.txt x' : 'printf x > ../outside.txt'
  assert.equal(classifyCommand({ command: parentWrite, workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
  assert.equal(classifyCommand({ command: 'Set-Content $env:USERPROFILE\\x.txt x', workdir: workspace, workspaceRoot: workspace }).decision, 'ai')
})
