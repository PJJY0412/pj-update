# 错题接收发送器（常驻托盘版）
# 双击 start.bat 启动，后台常驻系统托盘，开机可自动启动
# 平板 App "发送错题" 填本机 IP + 端口 8899（同一网络）或选"跨网络"（云端）
$ErrorActionPreference = 'Stop'

$port = 8899
$baseDir = Join-Path $PSScriptRoot '错题接收'
$logFile = Join-Path $PSScriptRoot '接收日志.txt'
$updDir = Join-Path $PSScriptRoot '更新'
$taskFile = Join-Path $PSScriptRoot '任务缓存.json'
$answerFile = Join-Path $PSScriptRoot '答案缓存.json'
$reportFile = Join-Path $PSScriptRoot '上报缓存.json'
$deletedStudentsFile = Join-Path $PSScriptRoot '已删学员.json'

# receiver.ps1 自身版本号（自举更新用）。每次对 receiver.ps1 做了需要分发到公司电脑的改动，
# 就把它 +1（日期格式，如 20260902-1 → 20260902-2）。开发机云端同步与自举均被 no-cloud-sync.dev 保护，
# 但 publish_update.ps1 会上传并随 version.json 下发；公司电脑仅在 版本更新 && hash 不同 时自替换重启。
$script:SelfVer = '20260902-1'

# ---------- AI 出题（举一反三） ----------
$aiKeyFile = Join-Path $PSScriptRoot 'ai-key.txt'
$aiDir = Join-Path $PSScriptRoot '_ai'
if (-not (Test-Path $aiDir)) { New-Item -ItemType Directory -Path $aiDir -Force | Out-Null }
$Script:aiJobs = @()
$Script:apkJobs = @()
$Script:aiPool = $null

# ── AI 出题平台配置（只改 工具\ai-config.txt，不用动本文件）────────────────
# 用记事本打开 工具\ai-config.txt，把 platform= 改成你用的平台名称即可：
#   deepseek（默认） qianfan(百度千帆) doubao(豆包) qwen(通义千问) kimi(月之暗面)
# API Key 填在 ai-config.txt 的 apikey= 或沿用旧文件 工具\ai-key.txt
# 豆包必须写 model=接入点ID；其余平台 model 留空用默认。
$aiMaxTokens = 1500
$aiConfigFile = Join-Path $PSScriptRoot 'ai-config.txt'

function Get-AiConfig {
    $cfg = @{ platform = 'deepseek'; apikey = ''; model = ''; json = $true }
    try {
        if (Test-Path $aiKeyFile) {
            $k = [System.IO.File]::ReadAllText($aiKeyFile).Trim()
            if (-not [string]::IsNullOrWhiteSpace($k)) { $cfg.apikey = $k }
        }
        if (Test-Path $aiConfigFile) {
            foreach ($line in [System.IO.File]::ReadAllLines($aiConfigFile)) {
                $t = [string]$line
                if ($null -eq $t) { continue }
                $t = $t.Trim()
                if (-not $t -or $t.StartsWith('#')) { continue }
                $idx = $t.IndexOf('=')
                if ($idx -le 0) { continue }
                $k = $t.Substring(0, $idx).Trim().ToLower()
                $v = $t.Substring($idx + 1).Trim()
                if ($k -eq 'platform') { $cfg.platform = $v.ToLower() }
                elseif ($k -eq 'apikey') { if ($v) { $cfg.apikey = $v } }
                elseif ($k -eq 'model') { $cfg.model = $v }
                elseif ($k -eq 'json') { $cfg.json = ($v.ToLower() -notmatch '^(off|false|0)$') }
            }
        }
        if ($cfg.platform -notmatch '^(deepseek|qianfan|doubao|qwen|kimi)$') { $cfg.platform = 'deepseek' }
    } catch {}
    return $cfg
}

function Resolve-AiEndpoint($platform, $cfgModel) {
    $def = @('https://api.deepseek.com/chat/completions', 'deepseek-chat')
    switch ($platform) {
        'qianfan' { $def = @('https://qianfan.baidubce.com/v2/chat/completions', 'ernie-4.0-8k') }
        'doubao'  { $def = @('https://ark.cn-beijing.volces.com/api/v3/chat/completions', '') }
        'qwen'    { $def = @('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-turbo') }
        'kimi'    { $def = @('https://api.moonshot.cn/v1/chat/completions', 'moonshot-v1-8k') }
    }
    if ([string]::IsNullOrWhiteSpace($cfgModel)) { return $def }
    return @($def[0], $cfgModel)
}
if (-not (Test-Path $baseDir)) { New-Item -ItemType Directory -Path $baseDir | Out-Null }
$autoDir = Join-Path $baseDir '自动导入'
if (-not (Test-Path $autoDir)) { New-Item -ItemType Directory -Path $autoDir | Out-Null }
$autoReadme = Join-Path $autoDir '使用说明.txt'
if (-not (Test-Path $autoReadme)) {
    $rm = @'
【自动导入错题】把 .txt 文件放进本文件夹即可自动入库（每行一道题）
文件名随意，年级/科目/目标都用【文件夹】表示，支持 1~3 层：
  1 层：自动导入\期中复习\题目.txt          → 不分年级科目，目标名"期中复习"
  2 层：自动导入\3年级\英语\题目.txt        → 3年级 英语（题目.txt 的文件名即目标名）
  3 层：自动导入\3年级\英语\期中复习\题目.txt → 3年级 英语，目标名"期中复习"
也可以把 题目.txt 直接放在本文件夹根目录（文件名即目标名）。
年级文件夹可写 3 / 3年级；科目文件夹可写 英语/语文/数学。
处理完的文件自动移动到 已处理\ 子文件夹。
（下发到平板请用"待下发"文件夹，见该文件夹说明）
'@
    [System.IO.File]::WriteAllText($autoReadme, $rm, (New-Object System.Text.UTF8Encoding $true))
}
$dspReadme = Join-Path $baseDir '待下发\使用说明.txt'
if (-not (Test-Path $dspReadme)) {
    $rm2 = @'
【下发到平板】把 .txt 文件放进本文件夹，平板"从电脑接收错题"选对应学生即可收到（每行一道题）
文件名随意，年级/科目/学生都用【文件夹】表示，支持 1~3 层：
  1 层：待下发\王小雨\题目.txt              → 发给 王小雨（不分年级科目）
  2 层：待下发\3年级\英语\题目.txt          → 学生名=题目.txt 的文件名
  3 层：待下发\3年级\英语\王小雨\题目.txt    → 发给 王小雨（3年级 英语）
也可以把 题目.txt 直接放在本文件夹根目录（学生名=文件名）。
年级文件夹可写 3 / 3年级；科目文件夹可写 英语/语文/数学。
处理完的文件自动移动到 已处理\ 子文件夹。
'@
    $dspDir2 = Join-Path $baseDir '待下发'
    if (-not (Test-Path $dspDir2)) { New-Item -ItemType Directory -Path $dspDir2 -Force | Out-Null }
    [System.IO.File]::WriteAllText($dspReadme, $rm2, (New-Object System.Text.UTF8Encoding $true))
}

$subjectNames = @{ english = '英语'; chinese = '语文'; math = '数学' }
function Get-SubjectName($s) {
    if (-not [string]::IsNullOrEmpty($s) -and $subjectNames.ContainsKey([string]$s)) { return $subjectNames[[string]$s] }
    if ([string]::IsNullOrEmpty($s)) { return '综合' }
    return [string]$s
}
function Get-SubjectCode($name) {
    if ([string]::IsNullOrEmpty($name)) { return '' }
    # 反向查找：中文科目名 → 编码；找不到时保留原文（兼容"综合"/未定义）
    foreach ($k in $subjectNames.Keys) {
        if ($subjectNames[$k] -eq ([string]$name).Trim()) { return $k }
    }
    return [string]$name
}
function Get-GradeFolderName($grade) {
    if ([string]::IsNullOrEmpty($grade)) { return '未分年级' }
    return "$grade" + '年级'
}
function Hide-File($path) {
    if (Test-Path -LiteralPath $path) {
        try { (Get-Item -LiteralPath $path -Force).Attributes = [System.IO.FileAttributes]::Hidden } catch {}
    }
}

function Read-TxtItems($txtPath) {
    $items = @()
    try {
        $cur = ''
        foreach ($ln in [System.IO.File]::ReadAllLines($txtPath)) {
            $t = [string]$ln
            $t = $t.Trim()
            if ($t.Length -eq 0) { continue }
            if ($t -match '^【(.+?)】共 .* 题$') { $cur = Get-SubjectCode $Matches[1].Trim(); continue }
            if ($t -match '^.*（\d*年级）错题集$') { continue }
            if ($t -match '^更新：') { continue }
            if ($t -match '^\d+\.\s*(.*)$') { $t = $Matches[1].Trim() }
            if ($t.Length -eq 0) { continue }
            $items += [PSCustomObject]@{ subject = $cur; text = $t }
        }
    } catch {}
    return $items
}

function Read-ErrorTxtSections($txtPath) {
    $out = @()
    try {
        $cur = ''
        foreach ($ln in [System.IO.File]::ReadAllLines($txtPath)) {
            $t = [string]$ln
            $t = $t.Trim()
            if ($t.Length -eq 0) { continue }
            if ($t -match '^【(.+?)】共 .* 题$') { $cur = $Matches[1].Trim(); continue }
            if ($t -match '^.*（\d*年级）错题集$') { continue }
            if ($t -match '^更新：') { continue }
            if ($t -match '^\d+\.\s*(.*)$') { $t = $Matches[1].Trim() }
            if ($t.Length -eq 0) { continue }
            $out += [PSCustomObject]@{ subject = $cur; text = $t }
        }
    } catch {}
    return $out
}

function Write-ErrorTxt($folder, $student, $gradeName, $items) {
    if (@($items).Count -eq 0) { return }
    $sb = New-Object System.Text.StringBuilder
    $null = $sb.AppendLine("$student（$gradeName）错题集")
    $null = $sb.AppendLine('更新：' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
    $null = $sb.AppendLine('')
    $groups = @{}
    foreach ($it in $items) {
        $key = Get-SubjectName $it.subject
        if (-not $groups.ContainsKey($key)) { $groups[$key] = @() }
        $groups[$key] += $it
    }
    foreach ($key in (@('语文', '数学', '英语') + (@($groups.Keys) | Where-Object { $_ -notin @('语文','数学','英语') }))) {
        if (-not $groups.ContainsKey($key)) { continue }
        $null = $sb.AppendLine("【" + $key + "】共 " + @($groups[$key]).Count + ' 题')
        $idx = 1
        foreach ($it in @($groups[$key])) {
            $null = $sb.AppendLine(('{0}. {1}' -f $idx, ([string]$it.text).Trim()))
            $idx++
        }
        $null = $sb.AppendLine('')
    }
    # 带 BOM 的 UTF-8，记事本/打印不乱码
    [System.IO.File]::WriteAllText((Join-Path $folder '错题.txt'), $sb.ToString(), (New-Object System.Text.UTF8Encoding $true))
}
function Save-ItemsToFolder($zone, $grade, $student, $items) {
    if (@($items).Count -eq 0) { return }
    $gradeName = Get-GradeFolderName $grade
    $safe = $student -replace '[\\/:*?"<>|]', '_'
    if ($zone -eq '待下发') {
        $batchName = (Get-Date).ToString('yyyy-MM-dd_HH-mm-ss') + '-' + $safe
        $groups = @{}
        foreach ($it in @($items)) {
            $sub = if ($it.subject) { [string]$it.subject } else { 'english' }
            $it.subject = $sub
            if (-not $groups.ContainsKey($sub)) { $groups[$sub] = @() }
            $groups[$sub] += $it
        }
        $total = 0
        foreach ($sub in $groups.Keys) {
            $subName = Get-SubjectName $sub
            $folder = Join-Path (Join-Path (Join-Path (Join-Path $baseDir $zone) $batchName) $gradeName) $subName
            $folder = Join-Path $folder $safe
            if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
            Write-ErrorTxt $folder $student $gradeName @($groups[$sub])
            $total += @($groups[$sub]).Count
        }
        Log ("下发：学员『{0}』（{1}）{2} 题 → {3}\{4}\{5}\{6}\{7}\{8}" -f $student, $gradeName, $total, (Split-Path $baseDir -Leaf), $zone, $batchName, $gradeName, (Get-SubjectName ($groups.Keys | Select-Object -First 1)), $safe)
        return
    }
    $folder = Join-Path (Join-Path (Join-Path $baseDir $zone) $gradeName) $safe
    if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
    $all = @()
    $txtPath = Join-Path $folder '错题.txt'
    if (Test-Path $txtPath) { $all = @(Read-ErrorTxtSections $txtPath) }
    $existing = @{}
    foreach ($e in $all) { $existing[[string]$e.text] = $true }
    $added = 0
    foreach ($it in @($items)) {
        $t = ([string]$it.text).Trim()
        if ($t.Length -eq 0) { continue }
        if ($existing.ContainsKey($t)) { continue }
        $existing[$t] = $true
        $all += [PSCustomObject]@{ subject = (Get-SubjectName $it.subject); text = $t }
        $added++
    }
    Write-ErrorTxt $folder $student $gradeName @($all)
    $action = if ($zone -eq '发送') { '手动录入' } else { '收到' }
    Log ("{0}：学员『{1}』（{2}）新增 {3} 题，累计 {4} 题 → {5}\{6}\{7}\{8}" -f $action, $student, $gradeName, $added, @($all).Count, (Split-Path $baseDir -Leaf), $zone, $gradeName, $safe)
}

# 推送学员名单到云端（GitHub update/students.json）：用电脑端学员库文件夹的最新名单覆盖云端，阻断"删除后复活"
function Sync-StudentsToCloud {
    try {
        # 生成最新名单（与 /students.json 同源：枚举学员库文件夹）
        $stDir = Join-Path $baseDir '学员库'
        $list = @()
        if (Test-Path $stDir) {
            Get-ChildItem $stDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $gd = ($_.Name -replace '年级$', '')
                Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                    $name = $_.Name
                    $createdAt = ''
                    $pf = Join-Path $_.FullName 'profile.json'
                    if (Test-Path $pf) {
                        try {
                            $j = [System.IO.File]::ReadAllText($pf) | ConvertFrom-Json
                            if ($j.name) { $name = [string]$j.name }
                            if ($j.createdAt) { $createdAt = [string]$j.createdAt }
                        } catch {}
                    }
                    $list += [PSCustomObject]@{ name = $name; grade = $gd; createdAt = $createdAt }
                }
            }
        }
        $stuJson = $list | ConvertTo-Json -Compress -Depth 4

        # 读取 GitHub 令牌
        $tf = Join-Path $env:USERPROFILE '.pj_update_token'
        if (-not (Test-Path $tf)) { Log '云端学员同步：未找到令牌，跳过'; return }
        $token = (Get-Content $tf -Raw -Encoding UTF8).Trim()
        if (-not $token) { Log '云端学员同步：令牌为空，跳过'; return }

        $repo = 'PJJY0412/pj-update'
        $api = "https://api.github.com/repos/$repo/contents/update/students.json"
        $contentB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($stuJson))
        $h = @{ Authorization = "token $token"; 'User-Agent' = 'pj-receiver'; Accept = 'application/vnd.github+json' }

        # 取现有文件的 sha（更新时必需）
        $sha = ''
        try {
            $existing = Invoke-RestMethod -Uri $api -Headers $h -Method Get -TimeoutSec 30
            if ($existing.sha) { $sha = [string]$existing.sha }
        } catch {}

        $body = @{ message = 'sync students after delete'; content = $contentB64; branch = 'master' }
        if ($sha) { $body.sha = $sha }
        $null = Invoke-RestMethod -Uri $api -Headers $h -Method Put -Body ($body | ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 60
        Log ("云端学员同步：已推送最新学员名单（{0} 人）" -f $list.Count)
    } catch {
        Log ("云端学员同步失败：{0}" -f $_.Exception.Message)
    }
}

# ---------- 学员删除墓碑：持久化"已删学员"名单，防止离线平板上线后全量推送把已删学员再次复活 ----------
# 返回已删学员墓碑名单 [{name, grade, at}]
function Get-DeletedStudents {
    if (-not (Test-Path -LiteralPath $deletedStudentsFile)) { return @() }
    try {
        $recs = Get-Content -LiteralPath $deletedStudentsFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -eq $recs) { return @() }
        return @($recs)
    } catch { return @() }
}

# 记录一次删除（防重复入块）
function Add-DeletedStudent([string]$name, [string]$grade) {
    $nm = ([string]$name).Trim()
    if ($nm.Length -eq 0) { return }
    $list = @(Get-DeletedStudents) | Where-Object { -not ([string]$_.name -eq $nm -and [string]$_.grade -eq [string]$grade) }
    $list += [PSCustomObject]@{ name = $nm; grade = [string]$grade; at = (Get-Date).ToUniversalTime().ToString('o') }
    [System.IO.File]::WriteAllText($deletedStudentsFile, (ConvertTo-Json -InputObject @($list) -Depth 4 -Compress), (New-Object System.Text.UTF8Encoding $false))
    Log ("学员墓碑：已记录已删学员『{0}』（{1}）" -f $nm, [string]$grade)
}

# 清除墓碑（平板显式重新注册同名学员时调用，恢复其建档资格）
function Clear-DeletedStudent([string]$name, [string]$grade) {
    $nm = ([string]$name).Trim()
    if ($nm.Length -eq 0) { return }
    $list = @(Get-DeletedStudents) | Where-Object { -not ([string]$_.name -eq $nm -and [string]$_.grade -eq [string]$grade) }
    [System.IO.File]::WriteAllText($deletedStudentsFile, (ConvertTo-Json -InputObject @($list) -Depth 4 -Compress), (New-Object System.Text.UTF8Encoding $false))
    Log ("学员墓碑：已为『{0}』（{1}）恢复注册资格" -f $nm, [string]$grade)
}

# 删除学员：清理电脑端该学员全部资料（平板删学员时经 POST /students 的 removed 字段触发）
function Remove-StudentData([string]$name, [string]$grade) {
    $nm = ([string]$name).Trim()
    if ($nm.Length -eq 0) { return }
    $safe = $nm -replace '[\\/:*?"<>|]', '_'
    # 1) 学员库：所有年级下的同名档案
    $stDir = Join-Path $baseDir '学员库'
    if (Test-Path $stDir) {
        Get-ChildItem $stDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $d = Join-Path $_.FullName $safe
            if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
    # 2) 接收 / 发送 错题：所有年级下的同名文件夹
    foreach ($zone in @('接收', '发送')) {
        $zDir = Join-Path $baseDir $zone
        if (-not (Test-Path $zDir)) { continue }
        Get-ChildItem $zDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $d = Join-Path $_.FullName $safe
            if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
    # 3) 待下发 批次：<时间>-<safe> 或 <时间>-<safe>-已下发
    $dspDir = Join-Path $baseDir '待下发'
    if (Test-Path $dspDir) {
        Get-ChildItem $dspDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $leaf = $_.Name
            if ($leaf.EndsWith('-' + $safe) -or $leaf.EndsWith('-' + $safe + '-已下发')) {
                Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
    # 4) 学情接收：所有年级下的同名文件夹
    $xjRoot = Join-Path $PSScriptRoot '学情接收'
    if (Test-Path $xjRoot) {
        Get-ChildItem $xjRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $d = Join-Path $_.FullName $safe
            if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
    # 5) 各 JSON 缓存：剔除该学员记录（按 name / toName 字段匹配）
    $cacheJobs = @(
        @{ File = $taskFile;   Match = 'toName' },
        @{ File = $answerFile; Match = 'name'  },
        @{ File = $reportFile; Match = 'name'  },
        @{ File = (Join-Path $PSScriptRoot '批阅结果.json'); Match = 'name' }
    )
    foreach ($j in $cacheJobs) {
        $f = $j.File
        if (-not (Test-Path $f)) { continue }
        try {
            $recs = @(Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json)
            if ($recs.Count -eq 0) { continue }
            $kept = @($recs | Where-Object {
                $m = $null
                if ($j.Match -eq 'toName') { $m = [string]($_.toName) }
                else { $m = [string]($_.name) }
                -not ([string]::IsNullOrEmpty($m) -or $m -eq $nm)
            })
            if ($kept.Count -lt $recs.Count) {
                $out = ConvertTo-Json -InputObject @($kept) -Depth 8 -Compress
                [System.IO.File]::WriteAllText($f, $out, (New-Object System.Text.UTF8Encoding $false))
            }
        } catch { }
    }
    # 6) 工具\更新\students.json（云端/局域网全量学员表）剔除同名，防止平板启动 mergeStudents 复活
    $stuFile = Join-Path $updDir 'students.json'
    if (Test-Path $stuFile) {
        try {
            $recs = @(Get-Content $stuFile -Raw -Encoding UTF8 | ConvertFrom-Json)
            if ($recs.Count -gt 0) {
                $kept = @($recs | Where-Object { -not ([string]::IsNullOrEmpty([string]($_.name)) -or [string]($_.name) -eq $nm) })
                if ($kept.Count -lt $recs.Count) {
                    [System.IO.File]::WriteAllText($stuFile, (ConvertTo-Json -InputObject @($kept) -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding $false))
                }
            }
        } catch { }
    }
    Log ("学员删除：平板已删除学员『{0}』，电脑端资料已清理" -f $nm)
    # 电脑本地学员库已清理 → 推送最新名单到云端，阻断"云端一同步又复活"
    Sync-StudentsToCloud
    # 记录永久墓碑：即使以后其他平板（离线中途上线）全量推送名单，也不能重建该学员档案
    Add-DeletedStudent $nm $grade
}

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Host $line
    try {
        [System.IO.File]::AppendAllText($logFile, $line + "`r`n", (New-Object System.Text.UTF8Encoding $false))
    } catch {}
}

function Read-TxtSmart($path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        return [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
    }
    $utf8 = [System.Text.Encoding]::UTF8.GetString($bytes)
    if ($utf8.Contains([char]0xFFFD)) { return [System.Text.Encoding]::GetEncoding(936).GetString($bytes) }
    return $utf8
}

function New-ItemObjectList($txt, $source) {
    $items = @()
    $idx = 0
    foreach ($line in ($txt -split "`r?`n")) {
        $l = $line.Trim()
        if ($l.Length -eq 0) { continue }
        $idx++
        $items += [PSCustomObject]@{
            id        = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) + $idx
            grade     = ''
            subject   = ''
            text      = $l
            source    = $source
            createdAt = (Get-Date).ToUniversalTime().ToString('o')
        }
    }
    return $items
}

function Resolve-SubjectId($name) {
    $subMap = @{ '英语' = 'english'; 'english' = 'english'; 'en' = 'english'; '语文' = 'chinese'; 'chinese' = 'chinese'; 'zh' = 'chinese'; '数学' = 'math'; 'math' = 'math'; 'ma' = 'math' }
    $key = ([string]$name).ToLower()
    if ($subMap.ContainsKey($key)) { return $subMap[$key] }
    return ''
}

function Parse-GradeFolder($name) {
    $g = (([string]$name) -replace '年级', '').Trim()
    if ($g -match '^[1-6]$') { return $g }
    return ''
}

function Scan-DropTreeDir($dir, $zone, $isImport, $rel, $doneDir) {
    Get-ChildItem $dir -Filter '*.txt' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '使用说明.txt' } | ForEach-Object {
        $f = $_
        $items = New-ItemObjectList (Read-TxtSmart $f.FullName) $(if ($isImport) { '电脑文件导入' } else { '电脑端下发' })
        if ($items.Count -eq 0) { return }
        $grade = ''
        $subject = ''
        $target = ''
        $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
        if ($rel.Count -eq 0) {
            $target = $base
        } elseif ($rel.Count -eq 1) {
            $target = $rel[0]
        } elseif ($rel.Count -eq 2) {
            $grade = Parse-GradeFolder $rel[0]
            $subject = Resolve-SubjectId $rel[1]
            $target = $base
        } else {
            $grade = Parse-GradeFolder $rel[0]
            $subject = Resolve-SubjectId $rel[1]
            $target = $rel[2]
        }
        if ($subject -ne '') {
            foreach ($it in $items) { $it.subject = $subject }
        }
        try {
            Save-ItemsToFolder $zone $grade $target $items
            $dest = Join-Path $doneDir $f.Name
            if (Test-Path $dest) {
                $dest = Join-Path $doneDir ([System.IO.Path]::GetFileNameWithoutExtension($f.Name) + '_' + (Get-Date).ToString('HHmmss') + [System.IO.Path]::GetExtension($f.Name))
            }
            Move-Item -LiteralPath $f.FullName -Destination $dest -Force
            if ($isImport) {
                Log ("自动导入: '{0}' → {1}年级/{2}/『{3}』，{4} 题" -f $f.Name, $grade, (Get-SubjectName $subject), $target, $items.Count)
            } else {
                Log ("自动下发: '{0}' → 学生『{1}』（{2}年级/{3}），{4} 题" -f $f.Name, $target, $grade, (Get-SubjectName $subject), $items.Count)
            }
        } catch {
            Log ("自动{0}失败: {1}：{2}" -f $(if ($isImport) { '导入' } else { '下发' }), $f.Name, $_.Exception.Message)
        }
    }
}

function Scan-DropFolders {
    $roots = @(
        @{ Path = Join-Path $baseDir '自动导入'; Zone = '发送'; Import = $true },
        @{ Path = Join-Path $baseDir '待下发'; Zone = '待下发'; Import = $false }
    )
    foreach ($r in $roots) {
        if (-not (Test-Path $r.Path)) { continue }
        $doneDir = Join-Path $r.Path '已处理'
        if (-not (Test-Path $doneDir)) { New-Item -ItemType Directory -Path $doneDir -Force | Out-Null }
        Scan-DropTreeDir $r.Path $r.Zone $r.Import @() $doneDir
        Get-ChildItem $r.Path -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '已处理' } | ForEach-Object {
            $l1 = $_
            Scan-DropTreeDir $l1.FullName $r.Zone $r.Import @($l1.Name) $doneDir
            Get-ChildItem $l1.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $l2 = $_
                Scan-DropTreeDir $l2.FullName $r.Zone $r.Import @($l1.Name, $l2.Name) $doneDir
                Get-ChildItem $l2.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                    $l3 = $_
                    Scan-DropTreeDir $l3.FullName $r.Zone $r.Import @($l1.Name, $l2.Name, $l3.Name) $doneDir
                }
            }
        }
    }
}

function Write-Utf8($stream, $text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $stream.Write($bytes, 0, $bytes.Length)
}

function Read-ByteLine($stream) {
    $line = New-Object System.Text.StringBuilder
    while ($true) {
        $b = $stream.ReadByte()
        if ($b -lt 0) { break }
        $line.Append([char]$b) | Out-Null
        if ($b -eq 10) { break }
    }
    return $line.ToString().TrimEnd("`r", "`n")
}

function Read-Body($stream, $contentLength) {
    if ($contentLength -le 0) { return '' }
    $buf = New-Object byte[] $contentLength
    $read = 0
    while ($read -lt $contentLength) {
        $n = $stream.Read($buf, $read, $contentLength - $read)
        if ($n -le 0) { break }
        $read += $n
    }
    return [System.Text.Encoding]::UTF8.GetString($buf, 0, $read)
}

function Send-Response($stream, $statusLine, $contentType, $body) {
    $headers = "HTTP/1.1 $statusLine`r`n"
    $headers += "Content-Type: $contentType; charset=utf-8`r`n"
    $headers += "Access-Control-Allow-Origin: *`r`n"
    $headers += "Access-Control-Allow-Methods: POST, GET, OPTIONS`r`n"
    $headers += "Access-Control-Allow-Headers: Content-Type`r`n"
    $headers += "Content-Length: $([System.Text.Encoding]::UTF8.GetByteCount($body))`r`n"
    $headers += "Connection: close`r`n`r`n"
    Write-Utf8 $stream $headers
    Write-Utf8 $stream $body
    $stream.Flush()
}

function Get-LocalIPs {
    $ips = @()
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'
    } | ForEach-Object { $ips += $_.IPAddress }
    if ($ips.Count -eq 0) {
        try {
            $hostname = [System.Net.Dns]::GetHostName()
            $ips = [System.Net.Dns]::GetHostAddresses($hostname) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | ForEach-Object { $_.IPAddress.ToString() }
        } catch {}
    }
    return $ips
}

function Get-GradeSummary {
    $zones = @()
    foreach ($zone in @('接收', '发送')) {
        $zoneDir = Join-Path $baseDir $zone
        $batches = @()
        if (Test-Path $zoneDir) {
            $entries = @()
            Get-ChildItem -Path $zoneDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $gradeDir = $_
                Get-ChildItem -Path $gradeDir.FullName -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName '错题.txt') } | ForEach-Object {
                    $n = @(Read-ErrorTxtSections (Join-Path $_.FullName '错题.txt')).Count
                    if ($n -gt 0) {
                        $entries += [PSCustomObject]@{ path = ($gradeDir.Name + '/' + $_.Name); count = $n }
                    }
                }
            }
            if ($entries.Count -gt 0) {
                $batches += [PSCustomObject]@{ batch = '（按学员汇总）'; entries = $entries }
            }
            Get-ChildItem -Path $zoneDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $batchDir = $_
                $bEntries = @()
                Get-ChildItem -Path $batchDir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                    $gradeDir = $_
                    Get-ChildItem -Path $gradeDir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                        $subDir = $_
                        Get-ChildItem -Path $subDir.FullName -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName '错题.txt') } | ForEach-Object {
                            $n = @(Read-TxtItems (Join-Path $_.FullName '错题.txt')).Count
                            if ($n -gt 0) {
                                $bEntries += [PSCustomObject]@{ path = ($gradeDir.Name + '/' + $subDir.Name + '/' + $_.Name); count = $n }
                            }
                        }
                    }
                }
                if ($bEntries.Count -gt 0) {
                    $batches += [PSCustomObject]@{ batch = $batchDir.Name; entries = $bEntries }
                }
            }
        }
        $zones += [PSCustomObject]@{ zone = $zone; batches = $batches }
    }
    return $zones
}

function Save-CloudItems($student, $items, $grade) {
    Save-ItemsToFolder '接收' $grade $student $items
    Log ("云端收到学员 '{0}' 错题 {1} 题" -f $student, @($items).Count)
}

function Add-CloudMessage($d) {
    if ($d.n -le 1) { Save-CloudItems $d.s @($d.items) $d.g; return }
    $entry = $cloudBatches.GetOrAdd([int]$d.b, { param($k) @{ parts = @{} } })
    $entry.parts[[int]$d.i] = $d
    if ($entry.parts.Count -ge [int]$d.n) {
        $items = @()
        for ($i = 0; $i -lt [int]$d.n; $i++) {
            if ($entry.parts.ContainsKey($i)) { $items += @($entry.parts[$i].items) }
        }
        Save-CloudItems $d.s $items $d.g
        $null = $cloudBatches.TryRemove([int]$d.b, [ref]$null)
    }
}

function Invoke-CloudOnce {
    try {
        $lastId = ''
        if (Test-Path $cloudProg) { $lastId = [System.IO.File]::ReadAllText($cloudProg).Trim() }
        $since = if ($lastId) { $lastId } else { 'all' }
        $req = [System.Net.HttpWebRequest]::Create("$cloudUrl/json?since=$since")
        $req.Method = 'GET'
        $req.Timeout = 1500
        $req.ReadWriteTimeout = 1500
        $req.UserAgent = 'pj-receiver/1.0'
        $resp = $req.GetResponse()
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
        $txt = $reader.ReadToEnd()
        $reader.Close()
        $resp.Close()
        if ([string]::IsNullOrWhiteSpace($txt)) { return $true }
        $list = @()
        foreach ($line in ($txt -split "`r?`n")) {
            $line = $line.Trim()
            if ($line.Length -eq 0) { continue }
            try { $list += @($line | ConvertFrom-Json) } catch {}
        }
        foreach ($m in $list) {
            if (-not $m.id) { continue }
            [System.IO.File]::WriteAllText($cloudProg, [string]$m.id, (New-Object System.Text.UTF8Encoding $false))
            try { $d = $m.message | ConvertFrom-Json } catch { continue }
            if ($d.s -and $d.items) { Add-CloudMessage $d }
        }
        return $true
    } catch { return $false }
}

function Add-GradedRecord($d) {
    try {
        $student = if ($null -ne $d.name) { [string]$d.name } else { return }
        $grade = if ($null -ne $d.grade) { [string]$d.grade } else { '' }
        $gradedFile = Join-Path $PSScriptRoot '批阅结果.json'
        $graded = @()
        try {
            if (Test-Path $gradedFile) {
                $gp = [System.IO.File]::ReadAllText($gradedFile) | ConvertFrom-Json
                if ($null -ne $gp) { $graded = @($gp) }
            }
        } catch {}
        $graded = @($graded | Where-Object { $null -eq $_ -or ([string]$_.name -ne $student -or [string]$_.taskId -ne [string]$d.taskId) })
        $graded += [PSCustomObject]@{
            name     = $student
            grade    = $grade
            taskId   = if ($null -ne $d.taskId) { [string]$d.taskId } else { '' }
            subject  = if ($null -ne $d.subject) { [string]$d.subject } else { '' }
            text     = if ($null -ne $d.text) { [string]$d.text } else { '' }
            myAnswer = if ($null -ne $d.myAnswer) { [string]$d.myAnswer } else { '' }
            answer   = if ($null -ne $d.answer) { [string]$d.answer } else { '' }
            correct  = if ($null -ne $d.correct) { [string]$d.correct } else { 'null' }
            gradedAt = if ($null -ne $d.gradedAt) { [string]$d.gradedAt } else { (Get-Date).ToUniversalTime().ToString('o') }
        }
        try {
            [System.IO.File]::WriteAllText($gradedFile, ($graded | ConvertTo-Json -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding $false))
        } catch { Log ("云端补拉写入批阅结果失败: {0}" -f $_.Exception.Message) }
        $safeName = [regex]::Replace($student, '[\\/:*?"<>|\r\n]', '_')
        $repDir = Join-Path $PSScriptRoot (('学情接收\{0}年级\{1}' -f $grade, $safeName))
        try { New-Item -ItemType Directory -Path $repDir -Force | Out-Null } catch {}
        $repFile = Join-Path $repDir '学情报告.txt'
        $isOk = ($d.correct -eq $true -or [string]$d.correct -eq 'True' -or [string]$d.correct -eq 'true' -or [string]$d.correct -eq '1')
        $lines = New-Object System.Collections.Generic.List[string]
        $lines.Add('════════════════════════════════════════')
        $lines.Add(('学员：{0}（{1}年级）　评分归档（云端补拉）：{2}' -f $student, $grade, (Get-Date).ToString('yyyy-MM-dd HH:mm')))
        $lines.Add('────────────────────────────────────────')
        $lines.Add(('{0} 1. {1}' -f $(if ($isOk) { '✅' } else { '❌' }), [string]$d.text))
        $lines.Add(('　　我的答案：{0}{1}' -f [string]$d.myAnswer, $(if (-not $isOk -and $d.answer) { '　标准答案：' + [string]$d.answer } else { '' })))
        $lines.Add('────────────────────────────────────────')
        $lines.Add(('本次得分：{0}/1　正确率 {1}%' -f $(if ($isOk) { 1 } else { 0 }), $(if ($isOk) { 100 } else { 0 })))
        $lines.Add('')
        $newTxt = $lines -join "`r`n"
        try {
            $old = ''
            if (Test-Path $repFile) { $old = [System.IO.File]::ReadAllText($repFile) }
            [System.IO.File]::WriteAllText($repFile, ($old + $newTxt), (New-Object System.Text.UTF8Encoding $true))
        } catch { Log ("云端补拉写入学情报告失败: {0}" -f $_.Exception.Message) }
        Log ("云端补拉评分归档：{0}（{1}年级）1 题" -f $student, $grade)
    } catch { Log ("云端补拉处理异常: {0}" -f $_.Exception.Message) }
}

function Format-MonthDay($s) {
    if ([string]::IsNullOrWhiteSpace([string]$s)) { return '' }
    $dt = $null
    try { $dt = [datetime]::ParseExact([string]$s.Trim(), 'ddd MMM dd yyyy', [System.Globalization.CultureInfo]::InvariantCulture) } catch {}
    if ($null -eq $dt) { try { $dt = [datetime]::Parse([string]$s) } catch {} }
    if ($null -eq $dt) { return [string]$s }
    return ('{0}月{1}日' -f $dt.Month, $dt.Day)
}

function Add-SubjectReportLines($lines, $st) {
    if ($null -eq $st -or $null -eq $st.subjects) { return }
    $subNames = @{ english = '英语'; chinese = '语文'; math = '数学' }
    foreach ($sk in @('english', 'chinese', 'math')) {
        try { $ss = $st.subjects.$sk } catch { continue }
        if ($null -ne $ss -and ([int]$ss.sessions -gt 0)) {
            $lines.Add(('📚{0}：{1}次 · {2}分钟 · 正确率 {3}%' -f $subNames[$sk], [int]$ss.sessions, [int]$ss.minutes, [int]$ss.accuracy))
        }
    }
}

function Add-GradedReportRecord($d) {
    try {
        $student = if ($null -ne $d.name) { [string]$d.name } else { return }
        $grade = if ($null -ne $d.grade) { [string]$d.grade } else { '' }
        $safeName = [regex]::Replace($student, '[\\/:*?"<>|\r\n]', '_')
        $repDir = Join-Path $PSScriptRoot (('学情接收\{0}年级\{1}' -f $grade, $safeName))
        try { New-Item -ItemType Directory -Path $repDir -Force | Out-Null } catch {}
        $repFile = Join-Path $repDir '学情报告.txt'
        $st = $d.stats
        $lines = New-Object System.Collections.Generic.List[string]
        $lines.Add('════════════════════════════════════════')
        $lines.Add(('学员：{0}（{1}年级）　学情评分归档（云端补拉）：{2}' -f $student, $grade, (Get-Date).ToString('yyyy-MM-dd HH:mm')))
        $lines.Add('────────────────────────────────────────')
        if ($null -ne $st) {
            $lines.Add(('⚡积分 {0}　Lv.{1}　⭐星星 {2}' -f [string]$st.xp, [string]$st.level, [string]$st.stars))
            $lines.Add(('📖已学 {0} 词　📚{1} 课时　🔥{2} 天连续　⏱{3} 分钟　❌错题 {4}' -f [string]$st.wordsLearned, [string]$st.lessons, [string]$st.streak, [string]$st.minutes, [string]$st.wrongs))
            Add-SubjectReportLines $lines $st
            $md = Format-MonthDay $st.lastPractice
            if ($md) { $lines.Add(('最近练习：{0}' -f $md)) }
        }
        $lines.Add('')
        $newTxt = $lines -join "`r`n"
        try {
            $old = ''
            if (Test-Path $repFile) { $old = [System.IO.File]::ReadAllText($repFile) }
            [System.IO.File]::WriteAllText($repFile, ($old + $newTxt), (New-Object System.Text.UTF8Encoding $true))
        } catch { Log ("云端补拉写入学情报告失败: {0}" -f $_.Exception.Message) }
        Log ("云端补拉学情评分归档：{0}（{1}年级）" -f $student, $grade)
    } catch { Log ("云端补拉学情处理异常: {0}" -f $_.Exception.Message) }
}

function Invoke-GradedOnce {
    try {
        $gProg = Join-Path $PSScriptRoot '批阅进度.txt'
        $lastId = ''
        if (Test-Path $gProg) { $lastId = [System.IO.File]::ReadAllText($gProg).Trim() }
        $since = if ($lastId) { $lastId } else { 'all' }
        $req = [System.Net.HttpWebRequest]::Create("$gradedUrl/json?since=$since")
        $req.Method = 'GET'
        $req.Timeout = 1500
        $req.ReadWriteTimeout = 1500
        $req.UserAgent = 'pj-receiver/1.0'
        $resp = $req.GetResponse()
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
        $txt = $reader.ReadToEnd()
        $reader.Close()
        $resp.Close()
        if ([string]::IsNullOrWhiteSpace($txt)) { return $true }
        $got = $false
        foreach ($line in ($txt -split "`r?`n")) {
            $line = $line.Trim()
            if ($line.Length -eq 0) { continue }
            try { $m = $line | ConvertFrom-Json } catch { continue }
            if (-not $m.id) { continue }
            [System.IO.File]::WriteAllText($gProg, [string]$m.id, (New-Object System.Text.UTF8Encoding $false))
            try { $d = $m.message | ConvertFrom-Json } catch { continue }
            if ($d -and $d.graded) {
                if ($d.kind -eq 'report') { Add-GradedReportRecord $d } else { Add-GradedRecord $d }
                $got = $true
            }
        }
        if ($got) { Log '云端补拉批阅：已写入批阅结果与学情报告' }
        return $true
    } catch { return $false }
}

function Start-ClaimsJob {
    if ($script:claimsJob -and ($script:claimsJob.State -eq 'Running')) { return }
    if ($script:claimsJob) {
        try { Remove-Job $script:claimsJob -Force } catch {}
        $script:claimsJob = $null
    }
    $script:claimsJob = Start-Job -ArgumentList $claimsUrl, $authFile -ScriptBlock {
        param($url, $file)
        try {
            $req = [System.Net.HttpWebRequest]::Create("$url/json?since=all")
            $req.Method = 'GET'
            $req.Timeout = 20000
            $req.ReadWriteTimeout = 30000
            $req.UserAgent = 'pj-receiver/1.0'
            $resp = $req.GetResponse()
            $stream = $resp.GetResponseStream()
            $stream.ReadTimeout = 4000
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
            $list = @()
            try {
                while ($true) {
                    $line = $reader.ReadLine()
                    if ($null -eq $line) { break }
                    $line = $line.Trim()
                    if ($line.Length -eq 0) { continue }
                    try {
                        $m = $line | ConvertFrom-Json
                        if ($m.message) {
                            $d = $m.message | ConvertFrom-Json
                            if ($d -and $d.d) { $list += ,@{ code = [string]$d.code; d = [string]$d.d; at = [string]$d.at } }
                        }
                    } catch {}
                }
            } catch {
                # 流空闲超时即视为读取完成（ntfy /json 为常开流）
            }
            $reader.Close()
            $resp.Close()
            [System.IO.File]::WriteAllText($file, ($list | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding $false))
            Write-Output ("claims synced: " + $list.Count)
        } catch { Write-Output ("claims job error: " + $_.Exception.Message) }
    }
}

function Migrate-LegacyLayout {
    $total = 0
    foreach ($zone in @('接收', '发送')) {
        $zoneDir = Join-Path $baseDir $zone
        if (-not (Test-Path $zoneDir)) { continue }
        Get-ChildItem -Path $zoneDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $batchDir = $_
            Get-ChildItem -Path $batchDir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $gradeDir = $_
                $gd = ($gradeDir.Name -replace '年级$', '')
                Get-ChildItem -Path $gradeDir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                    $subDir = $_
                    Get-ChildItem -Path $subDir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                        $txtPath = Join-Path $_.FullName '错题.txt'
                        if (Test-Path $txtPath) {
                            $its = @(Read-ErrorTxtSections $txtPath)
                            if ($its.Count -gt 0) {
                                Save-ItemsToFolder $zone $gd $_.Name $its
                                $total += $its.Count
                            }
                        }
                    }
                }
            }
        }
    }
    if ($total -gt 0) { Log ("旧目录结构已迁移：{0} 题合并到 年级\学员 新结构" -f $total) }
}

function Get-UpdFileInfo($path) {
    if (-not (Test-Path $path)) { return $null }
    $f = Get-Item $path
    $hash = (Get-FileHash $path -Algorithm SHA256).Hash
    $info = @{ hash = $hash; updated = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'); size = $f.Length }
    if ($path -like '*.js') {
        try {
            $c = [System.IO.File]::ReadAllText($path)
            $m = [regex]::Match($c, "__SERVER_VER\s*=\s*'([^']+)'")
            if ($m.Success) { $info.version = $m.Groups[1].Value }
        } catch {}
    }
    return $info
}

# ---------- 云端自动同步更新目录（开发电脑异地发布用） ----------
$cloudSyncUrls = @(
    'https://raw.githubusercontent.com/PJJY0412/pj-update/master/update/version.json',
    'https://cdn.jsdelivr.net/gh/PJJY0412/pj-update@master/update/version.json'
)
$cloudSyncList = @('app.js', 'storage.js', 'students.json')

function Get-CloudUpdMeta {
    foreach ($u in $cloudSyncUrls) {
        try {
            $r = Invoke-RestMethod -Uri $u -Method Get -TimeoutSec 20
            if ($null -ne $r -and $null -ne $r.apk) { return $r }
        } catch {}
    }
    return $null
}

function Update-SingleCloudFile($target, $urlList, $expHash, $TimeoutSec = 300) {
    # $urlList 可传单个 url 字符串或数组（主源+镜像），依次尝试直到校验通过
    if ($null -eq $urlList) { return $false }
    $cands = @($urlList | Where-Object { $_ -and -not [string]::IsNullOrEmpty([string]$_) })
    $tmp = $target + '.downloading'
    foreach ($u in $cands) {
        try {
            if (Test-Path $tmp) { Remove-Item $tmp -Force }
            Log ("云端同步：下载 {0} ← {1}（超时 {2}s）" -f (Split-Path $target -Leaf), ([string]$u), $TimeoutSec)
            Invoke-WebRequest -Uri $u -OutFile $tmp -TimeoutSec $TimeoutSec -UseBasicParsing
            $h = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
            if ($expHash -and $h -ne $expHash.ToLower()) {
                Log ("云端同步：{0} 校验失败（{1}...），换下一来源" -f (Split-Path $target -Leaf), $h.Substring(0, 8))
                Remove-Item $tmp -Force
                continue
            }
            Move-Item -LiteralPath $tmp -Destination $target -Force
            return $true
        } catch {
            Log ("云端同步：下载失败 {0}：{1}" -f (Split-Path $target -Leaf), $_.Exception.Message)
        }
    }
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    return $false
}

function Sync-CloudUpdateDir {
    # 开发机保护：存在 no-cloud-sync.dev 标记时跳过云端同步（防止云端旧版覆盖本地未发布改动）
    if (Test-Path (Join-Path $PSScriptRoot 'no-cloud-sync.dev')) { return }
    $v = Get-CloudUpdMeta
    if ($null -eq $v) { Log '云端同步：无法获取云端版本信息（网络不通？）'; return }
    $upd = 0
    foreach ($fn in $cloudSyncList) {
        $meta = $v.files.$fn
        if ($null -eq $meta -or [string]::IsNullOrEmpty($meta.hash)) { continue }
        $target = Join-Path $updDir $fn
        $cur = if (Test-Path $target) { (Get-UpdFileInfo $target).hash } else { '' }
        if ($cur -and $cur.ToLower() -eq ([string]$meta.hash).ToLower()) { continue }
        Log ("云端同步：发现新版 {0}（{1}）" -f $fn, $meta.version)
        if (Update-SingleCloudFile $target $meta.url $meta.hash) {
            Log ("云端同步：{0} 已更新为 {1}" -f $fn, $meta.version)
            $upd++
        }
    }
    # 桌面网页版同步：把云端更新的 app.js/storage.js 一并镜像到网页版 js\ 目录（管理员刷新浏览器即生效）
    $webJsDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'js'
    if (Test-Path $webJsDir) {
        foreach ($fn in @('app.js', 'storage.js')) {
            $src = Join-Path $updDir $fn
            $dst = Join-Path $webJsDir $fn
            if (-not (Test-Path $src) -or -not (Test-Path $dst)) { continue }
            $h1 = (Get-FileHash $src -Algorithm SHA256).Hash
            $h2 = (Get-FileHash $dst -Algorithm SHA256).Hash
            if ($h1 -ne $h2) {
                Copy-Item $src $dst -Force
                Log ("云端同步：网页版 js\{0} 已镜像为云端新版" -f $fn)
            }
        }
    }
    if ($null -ne $v.apk -and -not [string]::IsNullOrEmpty($v.apk.hash)) {
        $apkPath = Join-Path $updDir '培基智多星学习系统.apk'
        $cur = if (Test-Path $apkPath) { (Get-FileHash $apkPath -Algorithm SHA256).Hash } else { '' }
        if (-not $cur -or $cur.ToLower() -ne ([string]$v.apk.hash).ToLower()) {
            Log ("云端同步：发现新版 App（{0}），下载中..." -f $v.apk.version)
            $bak = Join-Path $updDir ("培基智多星学习系统_云端backup.apk")
            $apkUrls = @()
            $first = ([string]$v.apk.url).Trim()
            if ($first) { $apkUrls += $first }
            if ($v.apk.mirrors) { $apkUrls += @($v.apk.mirrors) }
            # 归一化出 GitHub 直连地址，兜底把 直连/gh-proxy/ghfast 三类都试一遍（防办公网某源被墙/超时）。
            # 注：直连 6x MB 在慢速带宽下可能 >300s，故 APK 用 900s 超时，否则"网络通但不快"会永远失败。
            $direct = $first -replace '^https://[^/]+/(https://github\.com/.*)$', '$1'
            if ($direct -ne $first) {
                $apkUrls += @("https://gh-proxy.com/$direct", "https://ghfast.top/$direct", $direct)
            } elseif ($first -match '^https://github\.com/.*releases/download/') {
                $apkUrls += @("https://gh-proxy.com/$first", "https://ghfast.top/$first", $first)
            }
            $apkUrls = @($apkUrls | Where-Object { $_ -and -not [string]::IsNullOrEmpty([string]$_) } | Select-Object -Unique)
            if (Update-SingleCloudFile $apkPath $apkUrls $v.apk.hash 900) {
                Log ("云端同步：App 已更新为 {0}" -f $v.apk.version)
                if (Test-Path $bak) { Remove-Item $bak -Force }
                Copy-Item $apkPath $bak -Force
                $upd++
            } else {
                Log ("云端同步：App 下载失败，保留现有版本（{0}）；可打开 http://127.0.0.1:8899/cloud-sync 重试" -f $v.apk.version)
                if (Test-Path $bak) { Copy-Item $bak $apkPath -Force -ErrorAction SilentlyContinue }
            }
        }
    }
    if ($upd -gt 0) { Log "云端同步完成：本次更新 $upd 个文件" }
}

# ---------- receiver.ps1 自举更新（公司电脑免人工换新） ----------
# 原理：publish_update.ps1 上传 receiver.ps1 到云端并写入 version.json files.receiver（带 version+hash+url）。
# 公司电脑在此处定期比较：本地 SelfVer 更新源版本、且当前 receiver.ps1 的 hash != 云端 hash 时，
# 下载到 __receiver_new.ps1 校验后，生成一个自删除的 __selfupd.ps1 交给独立进程执行——它会杀掉 8899 监听者
# （即当前 receiver 进程）、用新文件覆盖 receiver.ps1，再拉起 watchdog（内部已守卫不会重复启动），
# 从而免人工到公司电脑替换重启。开发机受 no-cloud-sync.dev 保护，永不自我覆盖。
function Sync-SelfUpdate {
    # 开发机保护：与 Sync-CloudUpdateDir 同源，存在标记则跳过（防止云端旧版覆盖本地未发布改动）
    if (Test-Path (Join-Path $PSScriptRoot 'no-cloud-sync.dev')) { return }
    $v = Get-CloudUpdMeta
    if ($null -eq $v) { return }
    $meta = $null
    try { $meta = $v.files.'receiver.ps1' } catch {}
    if ($null -eq $meta -or [string]::IsNullOrEmpty([string]$meta.hash)) {
        Log '自举更新：云端无 receiver.ps1 元数据，跳过'
        return
    }
    # 防降级：仅当云端版本 > 本地 SelfVer 才更新（与项目"版本号字符串序比较、不靠内容猜"一致）
    $remoteVer = [string]$meta.version
    try {
        if ($null -ne $meta.version -and [string]::Compare($remoteVer, $script:SelfVer, [System.StringComparison]::Ordinal) -le 0) {
            Log ("自举更新：云端 receiver 版本 {0} 不高于本地 {1}，跳过" -f $remoteVer, $script:SelfVer)
            return
        }
    } catch { return }
    $selfPath = $MyInvocation.MyCommand.Path
    if ([string]::IsNullOrEmpty($selfPath) -or -not (Test-Path $selfPath)) { $selfPath = Join-Path $PSScriptRoot 'receiver.ps1' }
    if (-not (Test-Path $selfPath)) { return }
    $curHash = (Get-FileHash $selfPath -Algorithm SHA256).Hash.ToLower()
    if ($curHash -eq ([string]$meta.hash).ToLower()) {
        Log ("自举更新：本地 receiver.ps1 已是最新（{0}）" -f $remoteVer)
        $script:SelfVer = $remoteVer
        return
    }
    Log ("自举更新：发现新版 receiver.ps1（{0}，本地 {1}），下载中..." -f $remoteVer, $script:SelfVer)
    $newPath = Join-Path $PSScriptRoot '__receiver_new.ps1'
    $urls = @([string]$meta.url)
    $urls = @($urls | Where-Object { $_ -and -not [string]::IsNullOrEmpty([string]$_) })
    if ($urls.Count -eq 0) { return }
    if (Update-SingleCloudFile $newPath $urls ([string]$meta.hash) 120) {
        Log "自举更新：new receiver.ps1 下载并校验通过，安排重启替换"
        New-SelfRestartUpdater $newPath
    } else {
        Log "自举更新：下载失败，保留当前 receiver.ps1"
    }
}

# 生成自删除重启脚本并后台启动（当前进程随后被其杀掉、替换、再由 watchdog 拉起新版）
function New-SelfRestartUpdater([string]$newFilePath) {
    $upPath = Join-Path $PSScriptRoot '__selfupd.ps1'
    $dst = Join-Path $PSScriptRoot 'receiver.ps1'
    $wd = Join-Path $PSScriptRoot 'watchdog.ps1'
    $body = @'
$ErrorActionPreference = 'SilentlyContinue'
Start-Sleep -Seconds 2
try {
    $c = Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue
    if ($c) {
        $p = @($c)[0].OwningProcess
        if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 800
    }
} catch {}
if (Test-Path $ENV:SELF_NEW) { Copy-Item $ENV:SELF_NEW $ENV:SELF_DST -Force }
Remove-Item $ENV:SELF_NEW -Force -ErrorAction SilentlyContinue
if (Test-Path $ENV:SELF_WD) {
    Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$ENV:SELF_WD | Out-Null
}
Remove-Item $ENV:SELF_UP -Force -ErrorAction SilentlyContinue
'@
    $body = $body -replace '\$ENV:SELF_NEW', ('"' + $newFilePath + '"')
    $body = $body -replace '\$ENV:SELF_DST', ('"' + $dst + '"')
    $body = $body -replace '\$ENV:SELF_WD', ('"' + $wd + '"')
    $body = $body -replace '\$ENV:SELF_UP', ('"' + $upPath + '"')
    # 写 UTF-8 带 BOM，避免 PowerShell 5.1 按 GBK 误解析中文路径
    try {
        [System.IO.File]::WriteAllBytes($upPath, (New-Object System.Text.UTF8Encoding($true)).GetPreamble() + ([System.Text.Encoding]::UTF8.GetBytes($body)))
        Log "自举更新：已生成重启脚本 $upPath，准备后台执行"
        Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$upPath | Out-Null
    } catch {
        Log ("自举更新：生成/启动重启脚本失败：{0}" -f $_.Exception.Message)
    }
}

# ---------- 文字识别（OCR，多平台） ----------
$ocrConfigFile = Join-Path $PSScriptRoot 'ocr-key.txt'

function Get-OcrConfig {
    $cfg = @{ platform = 'baidu'; apiKey = ''; apiSecret = ''; appId = ''; region = '' }
    try {
        if (Test-Path $ocrConfigFile) {
            foreach ($line in [System.IO.File]::ReadAllLines($ocrConfigFile)) {
                $t = [string]$line
                if ($null -eq $t) { continue }
                $t = $t.Trim()
                if (-not $t -or $t.StartsWith('#')) { continue }
                $idx = $t.IndexOf('=')
                if ($idx -le 0) { continue }
                $k = $t.Substring(0, $idx).Trim().ToLower()
                $v = $t.Substring($idx + 1).Trim()
                if ($k -eq 'platform') { if ($v) { $cfg.platform = $v.ToLower() } }
                elseif ($k -eq 'api_key') { if ($v) { $cfg.apiKey = $v } }
                elseif ($k -eq 'secret_key') { if ($v) { $cfg.apiSecret = $v } }
                elseif ($k -eq 'secret_id') { if ($v) { $cfg.apiKey = $v } }
                elseif ($k -eq 'app_id') { if ($v) { $cfg.appId = $v } }
                elseif ($k -eq 'key') { if ($v) { $cfg.apiKey = $v } }
                elseif ($k -eq 'secret') { if ($v) { $cfg.apiSecret = $v } }
                elseif ($k -eq 'region') { if ($v) { $cfg.region = $v } }
            }
        }
    } catch {}
    return $cfg
}

function Invoke-BaiduOcr($cfg, $imageBase64) {
    try {
        $tokenRes = Invoke-RestMethod -Uri ('https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=' + [uri]::EscapeDataString($cfg.apiKey) + '&client_secret=' + [uri]::EscapeDataString($cfg.apiSecret)) -Method Get -TimeoutSec 20
        if (-not $tokenRes.access_token) { return @{ ok = $false; err = '百度获取令牌失败' } }
        $body = 'image=' + [uri]::EscapeDataString($imageBase64)
        $ocrRes = Invoke-RestMethod -Uri ('https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=' + $tokenRes.access_token) -Method Post -ContentType 'application/x-www-form-urlencoded; charset=UTF-8' -Body $body -TimeoutSec 25
        if ($ocrRes.error_code) { return @{ ok = $false; err = ('百度识别失败：' + $ocrRes.error_msg) } }
        $texts = @($ocrRes.words_result | ForEach-Object { $_.words })
        if ($texts.Count -eq 0) { return @{ ok = $false; err = '未识别到文字' } }
        return @{ ok = $true; text = ($texts -join "`n") }
    } catch {
        return @{ ok = $false; err = ('百度识别异常：' + $_.Exception.Message) }
    }
}

function Invoke-TencentOcr($cfg, $imageBase64) {
    try {
        $hostName = 'ocr.tencentcloudapi.com'
        $service = 'ocr'
        $action = 'GeneralBasicOCR'
        $version = '2018-11-19'
        $region = [string]$cfg.region
        if ([string]::IsNullOrWhiteSpace($region) -or $region -eq '') { $region = 'ap-guangzhou' }
        $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $date = (Get-Date -Date ([DateTimeOffset]::FromUnixTimeSeconds($ts).UtcDateTime) -Format 'yyyy-MM-dd')
        $payload = ('{"ImageBase64":"' + $imageBase64 + '"}')
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        $hex = { param($b) ([System.BitConverter]::ToString($b)).Replace('-', '').ToLower() }
        $payloadHex = & $hex ([byte[]]$sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($payload)))
        $hdr = 'content-type:application/json; charset=utf-8'
        $canonicalRequest = "POST`n/`n`n$hdr`nhost:$hostName`n`ncontent-type;host`n$payloadHex"
        $canonicalHex = & $hex ([byte[]]$sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonicalRequest)))
        $stringToSign = "TC3-HMAC-SHA256`n$ts`n$date/$service/tc3_request`n$canonicalHex"
        $hmac = { param($key, $msg, $hash)
            $h = New-Object System.Security.Cryptography.HMACSHA256
            $h.Key = [System.Text.Encoding]::UTF8.GetBytes($key)
            if ($hash) { $h.HashName = $hash }
            return $h.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($msg))
        }
        $kDate = & $hmac ('TC3' + $cfg.apiSecret) $date $null
        $kService = & $hmac ($kDate) $service $null
        $kSigning = & $hmac ($kService) 'tc3_request' $null
        $signature = & $hex ([byte[]]((& $hmac ($kSigning) $stringToSign $null)))
        $authorization = "TC3-HMAC-SHA256 Credential=$($cfg.apiKey)/$date/$service/tc3_request, SignedHeaders=content-type;host, Signature=$signature"
        $headers = @{ 'Authorization' = $authorization; 'X-TC-Action' = $action; 'X-TC-Version' = $version; 'X-TC-Timestamp' = [string]$ts; 'X-TC-Region' = $region; 'Content-Type' = 'application/json; charset=utf-8' }
        $raw = Invoke-WebRequest -Uri ('https://' + $hostName) -Method Post -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) -UseBasicParsing -TimeoutSec 25
        try { $r = $raw.Content | ConvertFrom-Json } catch { return @{ ok = $false; err = '腾讯响应解析失败' } }
        if ($r.Response.Error) { return @{ ok = $false; err = ('腾讯识别失败：' + $r.Response.Error.Message) } }
        if ($null -eq $r.Response.TextDetections) { return @{ ok = $false; err = '未识别到文字' } }
        $texts = @($r.Response.TextDetections | ForEach-Object { $_.DetectedText })
        if ($texts.Count -eq 0) { return @{ ok = $false; err = '未识别到文字' } }
        return @{ ok = $true; text = ($texts -join "`n") }
    } catch {
        return @{ ok = $false; err = ('腾讯识别异常：' + $_.Exception.Message) }
    }
}

function Invoke-XfyunOcr($cfg, $imageBase64) {
    try {
        $xParam = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('{"language":"cn"}'))
        $form = @{ image = $imageBase64; appid = $cfg.appId; x_param = $xParam }
        $auth = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($cfg.apiKey + ':' + $cfg.apiSecret))
        $headers = @{ 'Authorization' = 'Basic ' + $auth }
        $resp = Invoke-RestMethod -Uri 'https://webapi.xfyun.cn/v1/service/v1/ocr' -Method Post -Headers $headers -Body $form -TimeoutSec 25
        if ($resp.code -eq 0 -and $resp.data -and $resp.data.result -and $resp.data.result.text) {
            return @{ ok = $true; text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($resp.data.result.text)) }
        }
        return @{ ok = $false; err = ('讯飞识别失败：' + ($resp.desc -as [string])) }
    } catch {
        return @{ ok = $false; err = ('讯飞识别异常：' + $_.Exception.Message) }
    }
}

function Invoke-Ocr($imageBase64) {
    $cfg = Get-OcrConfig
    if ($cfg.platform -eq 'tencent') {
        if (-not $cfg.apiKey -or -not $cfg.apiSecret) { return @{ ok = $false; err = '电脑端未配置腾讯云 SECRET_ID / SECRET_KEY（工具\ocr-key.txt）' } }
        return Invoke-TencentOcr $cfg $imageBase64
    }
    elseif ($cfg.platform -eq 'xfyun') {
        if (-not $cfg.apiSecret -or -not $cfg.appId) { return @{ ok = $false; err = '电脑端未配置讯飞 KEY / APP_ID（工具\ocr-key.txt）' } }
        return Invoke-XfyunOcr $cfg $imageBase64
    }
    if (-not $cfg.apiKey -or -not $cfg.apiSecret) { return @{ ok = $false; err = '电脑端未配置百度 API_KEY / SECRET_KEY（工具\ocr-key.txt）' } }
    return Invoke-BaiduOcr $cfg $imageBase64
}

function Send-FileResponse($stream, $filePath, $contentType) {
    if (-not (Test-Path $filePath)) {
        Send-Response $stream '404 Not Found' 'text/plain' '404'
        return
    }
    $fs = [System.IO.File]::OpenRead($filePath)
    try {
        $len = $fs.Length
        $headers = "HTTP/1.1 200 OK`r`n"
        $headers += "Content-Type: $contentType`r`n"
        $headers += "Access-Control-Allow-Origin: *`r`n"
        $headers += "Access-Control-Allow-Methods: POST, GET, OPTIONS`r`n"
        $headers += "Access-Control-Allow-Headers: Content-Type`r`n"
        $headers += "Content-Length: $len`r`n"
        $headers += "Connection: close`r`n"
        $headers += "Cache-Control: no-store, no-cache, must-revalidate`r`n"
        $headers += "Pragma: no-cache`r`n`r`n"
        $hdrBytes = [System.Text.Encoding]::UTF8.GetBytes($headers)
        $stream.Write($hdrBytes, 0, $hdrBytes.Length)
        $stream.Flush()
        $buf = New-Object byte[] 65536
        while ($true) {
            $n = $fs.Read($buf, 0, $buf.Length)
            if ($n -le 0) { break }
            $stream.Write($buf, 0, $n)
            $stream.Flush()
        }
    } finally {
        $fs.Dispose()
    }
}

function Start-AiJob($taskId, $subject, $text, $grade) {
    $cfg = Get-AiConfig
    if (-not $cfg.apikey) { return $false }
    $ep = Resolve-AiEndpoint $cfg.platform $cfg.model
    if (-not $ep[1]) {
        Log ("AI出题平台 {0} 需要填写 model（豆包请填接入点ID），本次任务已放弃" -f $cfg.platform)
        return $false
    }
    if ($null -eq $Script:aiPool) {
        try { $Script:aiPool = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspacePool(1, 3); $Script:aiPool.Open() } catch { return $false }
    }
    $subjName = Get-SubjectName $subject
    $prompt = ("原题（" + $subjName + ("，" + $grade + "年级" ) + "）：" + $text)
    $sysMsg = @'
你是资深小学出题老师。根据用户提供的一道原题，生成 3 道变式练习题供学生巩固：
第 1 道是"相似题"：知识点与题型完全相同，仅更换数字/词语/情境；
第 2 道和第 3 道是"举一反三"：同一知识点换成新的生活情境或问法，避免与相似题雷同。
要求：
1. 难度符合对应年级，语言亲切易懂，是学生平时会遇到的真实情境；
2. 数学题答案必须准确、可验算，答案写完整（含单位）；
3. 语文题围绕识字、组词、造句、近反义词、多音字展开；
4. 英语题围绕单词拼写、选词填空、造句展开，题干用中文，答案写英文；
5. 只输出一个 JSON 对象：{"items":[{"text":"题干","answer":"答案","note":"知识点说明"},...]}，items 恰好 3 项，不要输出任何其他内容。
'@
    $outFile = Join-Path $aiDir ("result_" + $taskId + ".json")
    $sb = {
        param($key, $sysMsg, $prompt, $outFile, $aiApiUrl, $aiModel, $aiMaxTokens, $aiJsonMode)
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        try {
            $messages = @(
                @{ role = 'system'; content = $sysMsg },
                @{ role = 'user'; content = $prompt }
            )
            $payload = @{
                model = $aiModel
                temperature = 0.8
                max_tokens = $aiMaxTokens
                messages = $messages
            }
            if ($aiJsonMode) { $payload.response_format = @{ type = 'json_object' } }
            $payload = $payload | ConvertTo-Json -Depth 8 -Compress
            $hdrs = @{ Authorization = ("Bearer " + $key); Accept = 'application/json' }
            $r = Invoke-RestMethod -Uri $aiApiUrl -Method Post -Headers $hdrs -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 45
            $content = [string]$r.choices[0].message.content
            $parsed = $content | ConvertFrom-Json
            $items = @()
            foreach ($it in @($parsed.items)) {
                $t = [string]$it.text
                if (-not [string]::IsNullOrWhiteSpace($t)) {
                    $items += @{ text = $t; answer = [string]$it.answer; note = [string]$it.note }
                }
            }
            $res = @{ ok = $true; items = @($items); err = '' } | ConvertTo-Json -Compress -Depth 6
            [System.IO.File]::WriteAllText($outFile, $res, $utf8)
        } catch {
            try {
                $res2 = @{ ok = $false; items = @(); err = 'api_err' } | ConvertTo-Json -Compress
                [System.IO.File]::WriteAllText($outFile, $res2, $utf8)
            } catch {}
        }
    }
    $ps = [PowerShell]::Create()
    $ps.RunspacePool = $Script:aiPool
    $null = $ps.AddScript($sb).AddArgument($cfg.apikey).AddArgument($sysMsg).AddArgument($prompt).AddArgument($outFile).AddArgument($ep[0]).AddArgument($ep[1]).AddArgument($aiMaxTokens).AddArgument($cfg.json)
    $handle = $ps.BeginInvoke()
    $Script:aiJobs += @{ id = $taskId; ps = $ps; handle = $handle; start = (Get-Date) }
    Log ("AI出题任务开始 {0}（{1}）" -f $taskId, $subjName)
    return $true
}

function Check-AiJobs {
    if (@($Script:aiJobs).Count -eq 0) { return }
    $finished = @()
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    foreach ($j in @($Script:aiJobs)) {
        $expired = ((Get-Date) - $j.start).TotalSeconds -gt 70
        if ($j.handle.IsCompleted -or $expired) {
            try {
                if (-not $j.handle.IsCompleted) { $j.handle.Stop() }
                try { $null = $j.ps.EndInvoke($j.handle) } catch {}
            } catch {}
            try { $j.ps.Dispose() } catch {}
            if ($expired -and -not (Test-Path (Join-Path $aiDir ("result_" + $j.id + ".json")))) {
                try { [System.IO.File]::WriteAllText((Join-Path $aiDir ("result_" + $j.id + ".json")), '{"ok":false,"items":[],"err":"timeout"}', $utf8) } catch {}
            }
            $finished += $j.id
        }
    }
    foreach ($id in $finished) {
        $Script:aiJobs = @($Script:aiJobs | Where-Object { $_.id -ne $id })
    }
}

function Handle-Http {
    $client = $null
    try {
        $client = $listener.AcceptTcpClient()
    } catch {
        return
    }
    try {
        $client.ReceiveTimeout = 8000
        $client.SendTimeout = 15000
        $swA = New-Object System.Diagnostics.Stopwatch
        $swA.Start()
        $stream = $client.GetStream()
        $requestLine = Read-ByteLine $stream
        $swA.Stop()
        if ([string]::IsNullOrEmpty($requestLine)) { $client.Close(); return }
        if ($requestLine.Contains('/check')) { Log ("/check 读行耗时: {0}ms" -f $swA.ElapsedMilliseconds) }

        $contentLength = 0
        while ($true) {
            $line = Read-ByteLine $stream
            if ([string]::IsNullOrEmpty($line)) { break }
            if ($line -match '^Content-Length:\s*(\d+)') { $contentLength = [int]$Matches[1] }
        }

        $parts = $requestLine.Split(' ')
        $method = $parts[0]
        $rawPath = if ($parts.Count -gt 1) { $parts[1] } else { '/' }
        $pathOnly = $rawPath
        $query = ''
        if ($rawPath.IndexOf('?') -ge 0) {
            $pathOnly = $rawPath.Substring(0, $rawPath.IndexOf('?'))
            $query = $rawPath.Substring($rawPath.IndexOf('?') + 1)
        }
        $pathOnly = [System.Uri]::UnescapeDataString($pathOnly)
        $clientIp = ''
        try { $clientIp = [string]$client.Client.RemoteEndPoint } catch {}
        Log ("收到请求 {0} {1}" -f $clientIp, $rawPath)

        if ($method -eq 'OPTIONS') {
            Send-Response $stream '204 No Content' 'text/plain' ''
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/check') {
            $sw = New-Object System.Diagnostics.Stopwatch
            $sw.Start()
            $app = Get-UpdFileInfo (Join-Path $updDir 'app.js')
            $sto = Get-UpdFileInfo (Join-Path $updDir 'storage.js')
            $apk = Get-UpdFileInfo (Join-Path $updDir '培基智多星学习系统.apk')
            if ($app.version) { $apk.version = $app.version }
            elseif ($apk.hash) { $apk.version = $apk.hash.Substring(0, 8) }
            $resp = @{ appjs = $app; storagejs = $sto; apk = $apk } | ConvertTo-Json -Compress
            Send-Response $stream '200 OK' 'application/json' $resp
            $sw.Stop()
            Log ("/check 耗时: {0}ms" -f $sw.ElapsedMilliseconds)
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/cloud-sync') {
            $swS = New-Object System.Diagnostics.Stopwatch
            $swS.Start()
            Log ("收到手动云端同步请求（来自 {0}）" -f $clientIp)
            try { Sync-CloudUpdateDir } catch { Log ("云端同步异常: {0}" -f $_.Exception.Message) }
            $swS.Stop()
            $respS = @{ ok = $true; ms = [int]$swS.ElapsedMilliseconds } | ConvertTo-Json -Compress
            Send-Response $stream '200 OK' 'application/json' $respS
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/ai-gen') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            if ($null -eq $json -or [string]::IsNullOrEmpty(([string]$json.text))) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"text missing"}'
            } else {
                $taskId = [string]$json.taskId
                if ($taskId -notmatch '^[A-Za-z0-9_]+$') { $taskId = 'ai' + [DateTime]::Now.Ticks + (Get-Random) }
                $subject = if ($null -ne $json.subject) { [string]$json.subject } else { 'english' }
                $grade = if ($null -ne $json.grade) { [string]$json.grade } else { '' }
                if (Start-AiJob $taskId $subject ([string]$json.text) $grade) {
                    Send-Response $stream '200 OK' 'application/json' ('{"ok":true,"taskId":"' + $taskId + '"}')
                } else {
                    Send-Response $stream '200 OK' 'application/json' '{"ok":false,"err":"no_key"}'
                }
            }
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/ai-gen') {
            $tid = ''
            if ($query -match 'taskId=([A-Za-z0-9_]+)') { $tid = $Matches[1] }
            if (-not $tid) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"taskId missing"}'
            } else {
                $f = Join-Path $aiDir ("result_" + $tid + ".json")
                if (Test-Path $f) {
                    $c = [System.IO.File]::ReadAllText($f)
                    Remove-Item $f -Force -ErrorAction SilentlyContinue
                    Send-Response $stream '200 OK' 'application/json' $c
                } else {
                    Send-Response $stream '200 OK' 'application/json' '{"ok":false,"pending":true}'
                }
            }
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/js/app.js') {
            Send-FileResponse $stream (Join-Path $updDir 'app.js') 'application/javascript; charset=utf-8'
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/js/storage.js') {
            Send-FileResponse $stream (Join-Path $updDir 'storage.js') 'application/javascript; charset=utf-8'
        }
        elseif ($method -eq 'GET' -and $pathOnly -match '^/sounds/letters/([A-Za-z0-9])\.wav$') {
            Send-FileResponse $stream (Join-Path $updDir ("sounds\letters\" + $Matches[1] + '.wav')) 'audio/wav'
        }
        elseif ($method -eq 'GET' -and $pathOnly -match '^/sounds/stroke-names/([0-9]+)\.wav$') {
            Send-FileResponse $stream (Join-Path $updDir ("sounds\stroke-names\" + $Matches[1] + '.wav')) 'audio/wav'
        }
        elseif ($method -eq 'GET' -and $pathOnly -match '^/sounds/pinyin/([0-9]+)\.ogg$') {
            Send-FileResponse $stream (Join-Path $updDir ("sounds\pinyin\" + $Matches[1] + '.ogg')) 'audio/ogg'
        }
        elseif ($method -eq 'GET' -and $pathOnly -match '^/sounds/sentences/([0-9]+)\.ogg$') {
            Send-FileResponse $stream (Join-Path $updDir ("sounds\sentences\" + $Matches[1] + '.ogg')) 'audio/ogg'
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/ocr-key') {
            $ocrFile = Join-Path $PSScriptRoot 'ocr-key.txt'
            $k = ''
            $s = ''
            if (Test-Path $ocrFile) {
                $lines = Get-Content $ocrFile -ErrorAction SilentlyContinue
                foreach ($ln in $lines) {
                    if ($ln -match '^\s*API_KEY\s*=\s*(\S+)\s*$') { $k = $Matches[1] }
                    elseif ($ln -match '^\s*SECRET_KEY\s*=\s*(\S+)\s*$') { $s = $Matches[1] }
                }
            }
            if ($k -and $s) {
                $resp = @{ ok = $true; apiKey = $k; secretKey = $s } | ConvertTo-Json -Compress
            } else {
                $resp = '{"ok":false}'
            }
            Send-Response $stream '200 OK' 'application/json' $resp
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/students.json') {
            # 实时从学员库文件夹动态生成（与 /students 同源），确保平板拉到的永远是电脑端真实已注册学员
            # （不再返回可能陈旧的静态 students.json，旧文件仅供云端同步方向使用）
            $list = @()
            $stDir = Join-Path $baseDir '学员库'
            if (Test-Path $stDir) {
                $dead = @{}
                foreach ($d in @(Get-DeletedStudents)) {
                    if ($null -ne $d -and $d.name) { $dead[[string]$d.name] = $true }
                }
                Get-ChildItem $stDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                    $gd = ($_.Name -replace '年级$', '')
                    Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                        $name = $_.Name
                        $createdAt = ''
                        $pf = Join-Path $_.FullName 'profile.json'
                        if (Test-Path $pf) {
                            try {
                                $j = [System.IO.File]::ReadAllText($pf) | ConvertFrom-Json
                                if ($j.name) { $name = [string]$j.name }
                                if ($j.createdAt) { $createdAt = [string]$j.createdAt }
                            } catch {}
                        }
                        if (-not $dead.ContainsKey($name)) {
                            $list += [PSCustomObject]@{ name = $name; grade = $gd; createdAt = $createdAt }
                        }
                    }
                }
            }
            Send-Response $stream '200 OK' 'application/json; charset=utf-8' ($list | ConvertTo-Json -Compress -Depth 4)
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/students/deleted') {
            # 下发删除墓碑名单：离线平板上线后拉取此列表，把电脑端已删除的学员从本地一并删除（防复活）
            $dead = @(Get-DeletedStudents)
            Send-Response $stream '200 OK' 'application/json; charset=utf-8' (ConvertTo-Json -InputObject $dead -Depth 4 -Compress)
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/api/students') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            if ($null -ne $json) {
                $stuFile = Join-Path $updDir 'students.json'
                $students = @($json) + @()  # 确保是数组
                # 合并去重（按 name）
                if (Test-Path $stuFile) {
                    $existing = Get-Content $stuFile -Raw | ConvertFrom-Json
                    $dict = @{}
                    foreach ($s in @($existing) + @($students)) {
                        if ($s -and $s.name) { $dict[$s.name] = $s }
                    }
                    $merged = $dict.Values
                } else {
                    $merged = $students
                }
                $merged | ConvertTo-Json -Compress -Depth 5 | Set-Content $stuFile -Encoding UTF8
                Send-Response $stream '200 OK' 'application/json' '{"ok":true}'
            } else {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"invalid json"}'
            }
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/ocr') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            if ($null -eq $json -or [string]::IsNullOrEmpty(([string]$json.image))) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"image missing"}'
            } else {
                $sw = New-Object System.Diagnostics.Stopwatch
                $sw.Start()
                $res = Invoke-Ocr ([string]$json.image)
                $sw.Stop()
                Log ("/ocr 识别耗时 {0}ms" -f $sw.ElapsedMilliseconds)
                $resp = $res | ConvertTo-Json -Compress
                Send-Response $stream '200 OK' 'application/json' $resp
            }
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/apk') {
            # APK 下载大文件 → 独立 Runspace 异步处理，不阻塞主线程
            $apkState = @{ Client = $client; Stream = $stream; Path = (Join-Path $updDir '培基智多星学习系统.apk'); CType = 'application/vnd.android.package-archive' }
            $rs = $null
            try { $rs = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace(); $rs.Open() } catch {}
            if ($rs) {
                $ps = [PowerShell]::Create()
                $ps.Runspace = $rs
                $null = $ps.AddScript({
                    param($st)
                    try {
                        if (-not [System.IO.File]::Exists($st.Path)) {
                            $err404 = [System.Text.Encoding]::UTF8.GetBytes("HTTP/1.1 404 Not Found`r`nContent-Length: 3`r`nConnection: close`r`n`r`n404")
                            $st.Stream.Write($err404, 0, $err404.Length)
                        } else {
                            $fs = [System.IO.File]::OpenRead($st.Path)
                            try {
                                $len = $fs.Length
                                $hdr = "HTTP/1.1 200 OK`r`nContent-Type: $($st.CType)`r`nAccess-Control-Allow-Origin: *`r`nContent-Length: $len`r`nConnection: close`r`nCache-Control: no-store`r`n`r`n"
                                $hdrBytes = [System.Text.Encoding]::UTF8.GetBytes($hdr)
                                $st.Stream.Write($hdrBytes, 0, $hdrBytes.Length)
                                $st.Stream.Flush()
                                $buf = New-Object byte[] 65536
                                while ($true) {
                                    $n = $fs.Read($buf, 0, $buf.Length)
                                    if ($n -le 0) { break }
                                    $st.Stream.Write($buf, 0, $n)
                                    $st.Stream.Flush()
                                }
                            } finally { $fs.Dispose() }
                        }
                    } catch {}
                    finally { try { $st.Stream.Close() } catch {}; try { $st.Client.Close() } catch {} }
                }).AddArgument($apkState)
                $handle = $ps.BeginInvoke()
                $Script:apkJobs += @{ ps = $ps; handle = $handle; rs = $rs; start = (Get-Date) }
                Log "APK 下载任务已异步启动"
            } else {
                try { Send-FileResponse $stream $apkState.Path $apkState.CType } catch {}
                finally { try { $stream.Close() } catch {}; try { $client.Close() } catch {} }
            }
            return
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/delete-items') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            $texts = @()
            if ($json -and $json.texts) { $texts = @($json.texts) | ForEach-Object { [string]$_ } }
            if ($texts.Count -eq 0) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"texts missing"}'
            } else {
                $removed = 0
                Get-ChildItem -Path $baseDir -Recurse -Filter '错题.txt' -File -ErrorAction SilentlyContinue | ForEach-Object {
                    $txtPath = $_.FullName
                    try {
                        $keep = @()
                        $changed = $false
                        foreach ($it in @(Read-ErrorTxtSections $txtPath)) {
                            if ($texts -contains [string]$it.text) { $removed++; $changed = $true }
                            else { $keep += $it }
                        }
                        if ($changed) {
                            if (@($keep).Count -eq 0) {
                                Remove-Item -LiteralPath $txtPath -Force -ErrorAction SilentlyContinue
                            } else {
                                $folder = Split-Path -Parent $txtPath
                                $student = Split-Path -Leaf $folder
                                $gradeName = '未分年级'
                                $up = Split-Path -Parent $folder
                                while ($up -and $up.Length -gt $baseDir.Length) {
                                    $leaf = Split-Path -Leaf $up
                                    if ($leaf -match '年级$') { $gradeName = $leaf; break }
                                    $up = Split-Path -Parent $up
                                }
                                Write-ErrorTxt $folder $student $gradeName @($keep)
                            }
                        }
                    } catch {}
                }
                Log ('网页删除错题：{0} 题' -f $removed)
                Send-Response $stream '200 OK' 'application/json' ('{"ok":true,"removed":' + $removed + '}')
            }
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/manual-add') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            if ($null -eq $json -or [string]::IsNullOrEmpty($json.folder) -or [string]::IsNullOrEmpty($json.text)) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"folder or text missing"}'
            } else {
                $folder = $json.folder
                $grade = if ($null -ne $json.grade) { [string]$json.grade } else { '' }
                $subject = if ($null -ne $json.subject) { [string]$json.subject } else { 'english' }
                $items = @()
                $now = (Get-Date).ToUniversalTime().ToString('o')
                $idx = 0
                foreach ($line in ([string]$json.text -split "`r?`n")) {
                    $line = $line.Trim()
                    if ($line.Length -eq 0) { continue }
                    $idx++
                    $items += [PSCustomObject]@{ id = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) + $idx; grade = $grade; subject = $subject; text = $line; source = '电脑手动录入'; createdAt = $now }
                }
                Save-ItemsToFolder '发送' $grade $folder $items
                $respBody = '{"ok":true,"grade":"' + $grade + '","count":' + $items.Count + '}'
                Send-Response $stream '200 OK' 'application/json' $respBody
            }
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/upload') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            if ($null -eq $json -or [string]::IsNullOrEmpty($json.student)) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"student missing"}'
            } else {
                $student = $json.student
                $grade = if ($null -ne $json.grade) { [string]$json.grade } else { '' }
                $items = @()
                if ($json.items) { $items = @($json.items) }
                Save-ItemsToFolder '接收' $grade $student $items
                $respBody = '{"ok":true,"grade":"' + $grade + '","count":' + $items.Count + '}'
                Send-Response $stream '200 OK' 'application/json' $respBody
            }
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/list-items') {
            $grade = ''
            $subject = ''
            if ($query -match '(^|&)grade=([^&]*)') { $grade = [System.Uri]::UnescapeDataString($Matches[2]) }
            if ($query -match '(^|&)subject=([^&]*)') { $subject = [System.Uri]::UnescapeDataString($Matches[2]) }
            $map = @{}
            foreach ($zone in @('接收', '发送')) {
                $zoneDir = Join-Path $baseDir $zone
                if (-not (Test-Path $zoneDir)) { continue }
                Get-ChildItem -Path $zoneDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                    $l1 = $_
                    Get-ChildItem -Path $l1.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                        $l2 = $_
                        $txtPath = Join-Path $l2.FullName '错题.txt'
                        if (Test-Path $txtPath) {
                            $gd = ($l1.Name -replace '年级$', '')
                            if ($grade -ne '' -and $gd -ne $grade) { return }
                            foreach ($it in @(Read-ErrorTxtSections $txtPath)) {
                                $t = [string]$it.text
                                if ($subject -ne '' -and [string]$it.subject -ne $subject) { continue }
                                if ($t.Trim().Length -gt 0 -and -not $map.ContainsKey($t)) {
                                    $map[$t] = [PSCustomObject]@{ text = $t; grade = $gd; subject = $it.subject; from = $l2.Name }
                                }
                            }
                        } else {
                            $gradeDir = $l2
                            $gd = ($gradeDir.Name -replace '年级$', '')
                            if ($grade -ne '' -and $gd -ne $grade) { return }
                            Get-ChildItem -Path $gradeDir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                                $sb = $_.Name
                                if ($subject -ne '' -and $sb -ne $subject) { return }
                                Get-ChildItem -Path $_.FullName -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName '错题.txt') } | ForEach-Object {
                                    foreach ($it in @(Read-TxtItems (Join-Path $_.FullName '错题.txt'))) {
                                        $t = [string]$it.text
                                        if ($t.Trim().Length -gt 0 -and -not $map.ContainsKey($t)) {
                                            $map[$t] = [PSCustomObject]@{ text = $t; grade = $gd; subject = $sb; from = $_.Name }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            $arr = @($map.Values)
            Send-Response $stream '200 OK' 'application/json' (@{ ok = $true; count = $arr.Count; items = $arr } | ConvertTo-Json -Depth 6 -Compress)
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/dispatch') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            if ($null -eq $json -or [string]::IsNullOrEmpty($json.student)) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"student missing"}'
            } else {
                $student = [string]$json.student
                $grade = if ($null -ne $json.grade) { [string]$json.grade } else { '' }
                $items = @()
                $i = 0
                foreach ($it in @($json.items)) {
                    $i++
                    $items += [PSCustomObject]@{
                        id        = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) + $i
                        subject   = if ($null -ne $it.subject) { [string]$it.subject } else { 'english' }
                        text      = [string]$it.text
                        source    = '电脑端下发'
                        createdAt = (Get-Date).ToString('o')
                    }
                }
                if ($items.Count -gt 0) {
                    try {
                        Save-ItemsToFolder '待下发' $grade $student $items
                    } catch {
                        Log ("保存待下发出错: {0}`n{1}" -f $_.Exception.Message, $_.ScriptStackTrace)
                    }
                }
                Send-Response $stream '200 OK' 'application/json' ('{"ok":true,"grade":"' + $grade + '","count":' + $items.Count + '}')
            }
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/students') {
            $stDir = Join-Path $baseDir '学员库'
            $list = @()
            if (Test-Path $stDir) {
                $dead = @{}
                foreach ($d in @(Get-DeletedStudents)) {
                    if ($null -ne $d -and $d.name) { $dead[[string]$d.name] = $true }
                }
                Get-ChildItem $stDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                    $gd = ($_.Name -replace '年级$', '')
                    Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                        $name = $_.Name
                        $createdAt = ''
                        $pf = Join-Path $_.FullName 'profile.json'
                        if (Test-Path $pf) {
                            try {
                                $j = [System.IO.File]::ReadAllText($pf) | ConvertFrom-Json
                                if ($j.name) { $name = [string]$j.name }
                                if ($j.createdAt) { $createdAt = [string]$j.createdAt }
                            } catch {}
                        }
                        if (-not $dead.ContainsKey($name)) {
                            $list += [PSCustomObject]@{ name = $name; grade = $gd; createdAt = $createdAt }
                        }
                    }
                }
            }
            Send-Response $stream '200 OK' 'application/json' (@{ ok = $true; count = $list.Count; students = $list } | ConvertTo-Json -Depth 4 -Compress)
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/deviceauth') {
            $dev = ''
            if ($query -match '(?:^|&)d=([^&]+)') { $dev = [System.Uri]::UnescapeDataString($Matches[1]) }
            $found = $false
            if ($dev -and (Test-Path $authFile)) {
                try {
                    $recs = Get-Content -LiteralPath $authFile -Raw -Encoding UTF8 | ConvertFrom-Json
                    foreach ($r in @($recs)) {
                        if ([string]$r.d -eq $dev) { $found = $true; break }
                    }
                } catch {}
            }
            Send-Response $stream '200 OK' 'application/json' (@{ ok = $true; found = $found } | ConvertTo-Json -Compress)
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/students') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            $added = 0
            if ($null -ne $json -and $json.students) {
                $stDir = Join-Path $baseDir '学员库'
                # 墓碑名单：全量同步推送时跳过已删学员，防离线平板把删除的学员"复活"回来
                $dead = @{}
                foreach ($d in @(Get-DeletedStudents)) {
                    if ($null -ne $d -and $d.name) { $dead[[string]$d.name] = $true }
                }
                # 平板显式重新注册（newStudents）：清除墓碑，允许重新建档（不用墓碑里的 remove 条目判断）
                if ($json.newStudents) {
                    foreach ($ns in @($json.newStudents)) {
                        $dn = ([string]$ns.name).Trim()
                        if ($dn.Length -gt 0) { Clear-DeletedStudent $dn ([string]$ns.grade) }
                    }
                }
                foreach ($s in @($json.students)) {
                    $nm = ([string]$s.name).Trim()
                    if ($nm.Length -eq 0) { continue }
                    if ($dead.ContainsKey($nm)) {
                        Log ('学员同步：跳过已删学员『{0}』（墓碑拦截，防复活）' -f $nm)
                        continue
                    }
                    $gd = [string]$s.grade
                    $safe = $nm -replace '[\\/:*?"<>|]', '_'
                    $dir = Join-Path (Join-Path $stDir (Get-GradeFolderName $gd)) $safe
                    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                    $pf = Join-Path $dir 'profile.json'
                    $payload = @{ name = $nm; grade = $gd; createdAt = [string]$s.createdAt; updatedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 4
                    [System.IO.File]::WriteAllText($pf, $payload, (New-Object System.Text.UTF8Encoding $false))
                    $added++
                    if ($gd -match '^\d+$') {
                        Get-ChildItem $stDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                            $gName = $_.Name
                            if ($gName -ne (Get-GradeFolderName $gd)) {
                                $oldDir = Join-Path $_.FullName $safe
                                if (Test-Path $oldDir) {
                                    Remove-Item $oldDir -Recurse -Force -ErrorAction SilentlyContinue
                                    Log ('学员归档：{0} 已升级/迁移 → 移除旧年级档案 {1}\{2}' -f $nm, $gName, $safe)
                                }
                            }
                        }
                    }
                }
                Log ('学员同步：平板推送 {0} 名学员 → 学员库\{1}年级 文件夹' -f $added, $gd)
            }
            if ($null -ne $json -and $json.removed) {
                foreach ($r in @($json.removed)) {
                    Remove-StudentData -name ([string]$r.name) -grade ([string]$r.grade)
                }
            }
            Send-Response $stream '200 OK' 'application/json' ('{"ok":true,"added":' + $added + '}')
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/pull') {
            $student = ''
            if ($query -match '(^|&)student=([^&]*)') { $student = [System.Uri]::UnescapeDataString($Matches[2]) }
            if ([string]::IsNullOrEmpty($student)) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"student missing"}'
            } else {
                $safe = $student -replace '[\\/:*?"<>|]', '_'
                $items = @()
                $hitBatches = @{}
                $dispatchDir = Join-Path $baseDir '待下发'
                if (Test-Path $dispatchDir) {
                    Get-ChildItem -Path $dispatchDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                        $batchRoot = $_
                        if ($batchRoot.Name -match '-已下发$') { return }
                        Get-ChildItem -Path $batchRoot.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                            Get-ChildItem -Path $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                                $sub = Join-Path $_.FullName $safe
                                if (Test-Path $sub) {
                                    $txtPath = Join-Path $sub '错题.txt'
                                    if (Test-Path $txtPath) {
                                        foreach ($it in @(Read-TxtItems $txtPath)) {
                                            if ($null -eq $it.grade) { $it | Add-Member -NotePropertyName 'grade' -NotePropertyValue (($_.Name -replace '年级$', '')) -Force }
                                            $items += $it
                                        }
                                        $hitBatches[$batchRoot.FullName] = $true
                                    }
                                }
                            }
                        }
                    }
                    foreach ($bp in $hitBatches.Keys) {
                        try {
                            Rename-Item -LiteralPath $bp -NewName ((Split-Path -Leaf $bp) + '-已下发') -ErrorAction Stop
                        } catch {}
                    }
                }
                foreach ($zone in @('接收', '发送')) {
                    $zoneDir = Join-Path $baseDir $zone
                    if (-not (Test-Path $zoneDir)) { continue }
                    Get-ChildItem -Path $zoneDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                        $gradeDir = $_
                        $gd = ($gradeDir.Name -replace '年级$', '')
Get-ChildItem -Path $gradeDir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                        if ($_.Name -ne $safe) { return }
                        $txtPath = Join-Path $_.FullName '错题.txt'
                        if (Test-Path $txtPath) {
                            foreach ($it in @(Read-TxtItems $txtPath)) {
                                if ($null -eq $it.grade) { $it | Add-Member -NotePropertyName 'grade' -NotePropertyValue $gd -Force }
                                $items += $it
                            }
                        }
                    }
                    }
                    Get-ChildItem -Path $zoneDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                        $batchDir = $_
                        Get-ChildItem -Path $batchDir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                            $gradeDir = $_
                            Get-ChildItem -Path $gradeDir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                                $sub = Join-Path $_.FullName $safe
                                if (Test-Path $sub) {
                                    $txtPath = Join-Path $sub '错题.txt'
                                    if (Test-Path $txtPath) {
                                        foreach ($it in @(Read-TxtItems $txtPath)) {
                                            if ($null -eq $it.grade) { $it | Add-Member -NotePropertyName 'grade' -NotePropertyValue ($gradeDir.Name -replace '年级$', '') -Force }
                                            $items += $it
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                $oldFolder = Join-Path $baseDir $safe
                if (Test-Path $oldFolder) {
                    Get-ChildItem -Path $oldFolder -Filter '错题_*.json' -File -ErrorAction SilentlyContinue | ForEach-Object {
                        try {
                            $j = [System.IO.File]::ReadAllText($_.FullName) | ConvertFrom-Json
                            if ($j.items) { $items += @($j.items) }
                        } catch {}
                    }
                }
                $dedup = @{}
                $uniq = @()
                foreach ($it in $items) {
                    $key = if ($it.id) { [string]$it.id } else { [string]$it.text }
                    if ($dedup.ContainsKey($key)) { continue }
                    $dedup[$key] = $true
                    $uniq += $it
                }
                $payload = @{ student = $student; items = $uniq } | ConvertTo-Json -Depth 8 -Compress
                Log ("平板取件：学员 '{0}'，共 {1} 题" -f $student, $uniq.Count)
                Send-Response $stream '200 OK' 'application/json' $payload
            }
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/') {
            $zones = Get-GradeSummary
            $html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>错题接收发送器</title>'
            $html += '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;max-width:680px;margin:24px auto;padding:0 16px;color:#333}h1{font-size:20px}h2{font-size:16px;margin:20px 0 8px}table{width:100%;border-collapse:collapse;margin-bottom:8px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:14px}th{background:#f5f5f5}code{background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:13px}.g{font-size:15px;font-weight:700;margin:14px 0 6px}.card{border-radius:8px;padding:14px;margin-bottom:16px}.sel{flex:1;min-width:90px;padding:6px;border-radius:6px;border:1px solid #ccc;background:#fff}.inp{width:100%;box-sizing:border-box;padding:6px;border-radius:6px;border:1px solid #ccc;margin-bottom:8px}.btn{width:100%;padding:10px;border:0;border-radius:6px;color:#fff;font-size:15px;cursor:pointer}.st{font-size:13px;margin-top:8px;min-height:18px}.chip{flex:1;min-width:60px;padding:6px;border-radius:6px;border:1px solid #ccc;background:#fff;font-size:13px;cursor:pointer}.chip.on{background:#2E7D32;color:#fff;border-color:#2E7D32}.sub{min-width:70px;padding:6px;border-radius:6px;border:1px solid #ccc;background:#fff;font-size:13px;cursor:pointer}.sub.on{background:#2E7D32;color:#fff;border-color:#2E7D32}.item{display:flex;gap:8px;align-items:flex-start;padding:5px 4px;border-bottom:1px solid #eee;font-size:13px}.item input{margin-top:2px}</style></head><body>'
            $html += "<h1>错题接收发送器</h1><p style='margin:0 0 4px'><b id='st-run'>状态：运行中</b>｜电脑 IP 见托盘气泡提示</p>"
            $html += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">'
            $html += '<a href="http://127.0.0.1:8899/" style="padding:6px 12px;border-radius:6px;background:#1565C0;color:#fff;text-decoration:none;font-size:13px">📋 录入 / 下发</a>'
            $html += '<a href="#dir" style="padding:6px 12px;border-radius:6px;background:#eee;color:#333;text-decoration:none;font-size:13px">📁 错题目录</a>'
            $html += '</div>'
            $html += '<div class="card" style="border:1px solid #90CAF9;background:#E3F2FD">'
            $html += '<h2 style="margin:0 0 10px">📋 录入错题（电脑）</h2>'
            $html += '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">'
            $html += '<select id="ma-grade" class="sub"><option value="">未分年级</option>'
            for ($g = 1; $g -le 6; $g++) { $html += '<option value="' + $g + '">' + $g + '年级</option>' }
            $html += '</select>'
            $html += '<select id="ma-subject" class="sub"><option value="english">英语</option><option value="chinese">语文</option><option value="math">数学</option></select>'
            $html += '<label class="sub" style="text-align:center;cursor:pointer;background:#fff">📂 导入 .txt 文件<input type="file" id="ma-file" accept=".txt,text/plain" style="display:none"></label>'
            $html += '</div>'
            $html += '<input id="ma-folder" class="inp" placeholder="目标文件夹名称（如：期中复习 / 公共错题库 / 张三）">'
            $html += '<textarea id="ma-text" rows="6" placeholder="每行一道题，可整段粘贴批量录入&#10;例如：&#10;apple 苹果&#10;teacher 老师" style="width:100%;box-sizing:border-box;padding:6px;border-radius:6px;border:1px solid #ccc;margin-bottom:8px"></textarea>'
            $html += '<button id="ma-do" class="btn" style="background:#1565C0">➕ 录入到该文件夹</button>'
            $html += '<div id="ma-status" class="st"></div>'
            $html += '</div>'
            $html += '<div class="card" style="border:1px solid #A5D6A7;background:#E8F5E9">'
            $html += '<h2 style="margin:0 0 10px">📤 下发到平板（按 年级 / 科目 / 学生）</h2>'
            $html += '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">'
            $html += '<input id="ds-student" class="inp" style="flex:1.6;min-width:120px" placeholder="学生姓名（平板端选同一姓名接收）">'
            $html += '<select id="ds-grade" class="sub"><option value="">全部年级</option>'
            for ($g = 1; $g -le 6; $g++) { $html += '<option value="' + $g + '">' + $g + '年级</option>' }
            $html += '</select>'
            $html += '</div>'
            $html += '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">'
            $html += '<button class="sub" id="ds-en" data-sub="英语">英语</button>'
            $html += '<button class="sub" id="ds-zh" data-sub="语文">语文</button>'
            $html += '<button class="sub" id="ds-ma" data-sub="数学">数学</button>'
            $html += '<button id="ds-load" class="sub" style="background:#1976D2;color:#fff;border-color:#1976D2">🔍 加载错题</button>'
            $html += '</div>'
            $html += '<div id="ds-items" style="display:none;max-height:260px;overflow:auto;background:#fff;border:1px solid #ccc;border-radius:6px;padding:6px 8px;margin-bottom:8px"></div>'
            $html += '<div id="ds-tool" style="display:none">'
            $html += '<div style="display:flex;gap:8px;margin-bottom:8px">'
            $html += '<button class="sub" id="ds-checkall">☑️ 全选</button>'
            $html += '<button class="sub" id="ds-uncheck">⬜ 清空</button>'
            $html += '<button class="sub" style="flex:1;background:#C62828;color:#fff;border-color:#C62828" id="ds-del">🗑 删除所选</button>'
            $html += '<button class="sub" style="flex:2;background:#2E7D32;color:#fff;border-color:#2E7D32" id="ds-send">📤 发送到平板</button>'
            $html += '</div>'
            $html += '<div id="ds-sendto" style="font-size:12px;color:#333;background:#fff;border:1px dashed #2E7D32;border-radius:6px;padding:6px 8px;margin-bottom:8px"></div>'
            $html += '</div>'
            $html += '<div id="ds-status" class="st"></div>'
            $html += '</div>'
            $html += '<script>'
            $html += 'var subs=[];function syncSubs(){subs=[];document.querySelectorAll(".sub[data-sub]").forEach(function(b){if(b.classList.contains("on"))subs.push(b.getAttribute("data-sub"));});}'
            $html += 'document.querySelectorAll(".sub[data-sub]").forEach(function(b){b.addEventListener("click",function(){this.classList.toggle("on");syncSubs();});});'
            $html += 'document.getElementById("ds-en").classList.add("on");syncSubs();'
            $html += 'function manualAdd(){'
            $html += 'var folder=document.getElementById("ma-folder").value.trim(),text=document.getElementById("ma-text").value,grade=document.getElementById("ma-grade").value,subject=document.getElementById("ma-subject").value;'
            $html += 'var st=document.getElementById("ma-status");'
            $html += 'if(!folder){st.innerHTML="<span style=color:#C62828>请输入文件夹名称</span>";return;}'
            $html += 'var lines=text.split(/\\r?\\n/).map(function(s){return s.trim()}).filter(function(s){return s.length>0});'
            $html += 'if(lines.length===0){st.innerHTML="<span style=color:#C62828>请输入题目内容</span>";return;}'
            $html += 'st.innerHTML="<span style=color:#1565C0>正在录入…</span>";'
            $html += 'fetch("/manual-add",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({folder:folder,grade:grade,subject:subject,text:text})}).then(function(r){return r.json()}).then(function(j){'
            $html += 'if(j.ok){st.innerHTML="<span style=color:#2E7D32>✅ 已录入 "+j.count+" 题 → 『"+folder+"』（"+((grade&&grade!=="")?grade+"年级":"未分年级")+"）</span>";document.getElementById("ma-text").value="";}'
            $html += 'else{st.innerHTML="<span style=color:#C62828>❌ 录入失败："+(j.err||"未知错误")+"</span>";}'
            $html += '}).catch(function(){st.innerHTML="<span style=color:#C62828>❌ 网络错误，请重试</span>";});'
            $html += '}'
            $html += 'document.getElementById("ma-do").addEventListener("click",manualAdd);'
            $html += 'document.getElementById("ma-file").addEventListener("change",function(){'
            $html += 'var f=this.files[0];if(!f)return;var rd=new FileReader();'
            $html += 'rd.onload=function(e){document.getElementById("ma-text").value=e.target.result;document.getElementById("ma-status").innerHTML="<span style=color:#2E7D32>已读取 "+f.name+"，确认后点录入</span>";};'
            $html += 'rd.readAsText(f);});'
            $html += 'var lastLoad={g:"",s:[]};'
            $html += 'document.getElementById("ds-load").addEventListener("click",function(){'
            $html += 'var g=document.getElementById("ds-grade").value,s=subs.join("|"),st=document.getElementById("ds-status");'
            $html += 'if(subs.length===0){st.innerHTML="<span style=color:#C62828>请至少选择一个科目</span>";return;}'
            $html += 'if(g===lastLoad.g&&s===lastLoad.s){loadShow();return;}'
            $html += 'st.innerHTML="<span style=color:#1565C0>正在加载…</span>";'
            $html += 'var q="?grade="+encodeURIComponent(g);'
            $html += 'var ps=subs.map(function(sb){return fetch("/list-items"+q+"&subject="+encodeURIComponent(sb)).then(function(r){return r.json()}).then(function(j){return j.items||[];}).catch(function(){return[];});});'
            $html += 'Promise.all(ps).then(function(lists){'
            $html += 'var all=[];var seen={};lists.forEach(function(l){l.forEach(function(it){if(!seen[it.text]){seen[it.text]=1;all.push(it);}});});'
            $html += 'lastLoad.g=g;lastLoad.s=s;window.__dsItems=all;'
            $html += 'loadShow();});'
            $html += '});'
            $html += 'function loadShow(){'
            $html += 'var box=document.getElementById("ds-items"),all=window.__dsItems||[];'
            $html += 'if(all.length===0){box.style.display="block";box.innerHTML="<div style=color:#999;padding:6px>暂无错题（先手动录入或等平板发送）</div>";document.getElementById("ds-tool").style.display="none";return;}'
            $html += 'var h="";all.forEach(function(it,i){h+="<label class=item><input type=checkbox data-i="+i+" checked>"+it.grade+"年级·"+it.subject+" <b>"+it.text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</b></label>";});'
            $html += 'box.innerHTML=h;box.style.display="block";'
            $html += 'var sendto=document.getElementById("ds-sendto");'
            $html += 'sendto.innerHTML="将发往平板：<b>"+(document.getElementById("ds-student").value.trim()||"(未填学生)")+"</b>，共 "+all.length+" 题";'
            $html += 'document.getElementById("ds-tool").style.display="block";'
            $html += 'document.getElementById("ds-status").innerHTML="<span style=color:#2E7D32>已加载 "+all.length+" 题，勾选后发送</span>";'
            $html += 'document.getElementById("ds-items").style.display="block";'
            $html += '}'
            $html += 'document.getElementById("ds-checkall").addEventListener("click",function(){document.querySelectorAll("#ds-items input").forEach(function(c){c.checked=true;});});'
            $html += 'document.getElementById("ds-uncheck").addEventListener("click",function(){document.querySelectorAll("#ds-items input").forEach(function(c){c.checked=false;});});'
            $html += 'document.getElementById("ds-del").addEventListener("click",function(){'
            $html += 'var st=document.getElementById("ds-status");'
            $html += 'var its=[];document.querySelectorAll("#ds-items input:checked").forEach(function(c){var it=window.__dsItems[parseInt(c.getAttribute("data-i"),10)];its.push(it.text);});'
            $html += 'if(its.length===0){st.innerHTML="<span style=color:#C62828>请勾选要删除的题目</span>";return;}'
            $html += 'if(!confirm("确定删除 "+its.length+" 题吗？删除后平板不再接收这些题"))return;'
            $html += 'fetch("/delete-items",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({texts:its})}).then(function(r){return r.json()}).then(function(j){'
            $html += 'st.innerHTML=j.removed?("<span style=color:#2E7D32>✅ 已删除 "+j.removed+" 题</span>"):"<span style=color:#C62828>没有匹配的题目</span>";'
            $html += 'lastLoad.g=null;document.getElementById("ds-load").click();'
            $html += '}).catch(function(){st.innerHTML="<span style=color:#C62828>❌ 网络错误，请重试</span>";});'
            $html += '});'
            $html += 'document.getElementById("ds-student").addEventListener("input",function(){var t=this.value.trim();if(!t||!window.__dsItems)return;document.getElementById("ds-sendto").textContent="将发送到平板："+t+"，共 "+window.__dsItems.length+" 题";});'
            $html += 'document.getElementById("ds-send").addEventListener("click",function(){'
            $html += 'var student=document.getElementById("ds-student").value.trim(),st=document.getElementById("ds-status");'
            $html += 'if(!student){st.innerHTML="<span style=color:#C62828>请填写学生姓名</span>";return;}'
            $html += 'var g=document.getElementById("ds-grade").value;'
            $html += 'var its=[];document.querySelectorAll("#ds-items input:checked").forEach(function(c){var it=window.__dsItems[parseInt(c.getAttribute("data-i"),10)];its.push({subject:it.subject,text:it.text});});'
            $html += 'if(its.length===0){st.innerHTML="<span style=color:#C62828>请勾选要发送的题目</span>";return;}'
            $html += 'st.innerHTML="<span style=color:#1565C0>正在发送 "+its.length+" 题…</span>";'
            $html += 'fetch("/dispatch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({student:student,grade:g,items:its})}).then(function(r){return r.json()}).then(function(j){'
            $html += 'if(j.ok){st.innerHTML="<span style=color:#2E7D32>✅ 已发送 "+j.count+" 题到平板："+student+"。平板「从电脑接收错题」→选同一学生→「接收」即可拿到</span>";window.__dsItems=[];loadShow();}'
            $html += 'else{st.innerHTML="<span style=color:#C62828>❌ 发送失败："+(j.err||"未知")+"</span>";}'
            $html += '}).catch(function(){st.innerHTML="<span style=color:#C62828>❌ 网络错误，请重试</span>";});'
            $html += '});'
            $html += '</script>'
            $html += '<a id="dir"></a><h2>错题目录（接收 / 发送 → 年级 → 学员，语数英按类别在同一文件）</h2>'
            if (($zones | ForEach-Object { $_.batches.Count } | Measure-Object -Sum).Sum -eq 0) {
                $html += '<p>暂无错题，等待平板发送或手动录入...</p>'
            } else {
                foreach ($z in $zones) {
                    $html += '<div class="g">📥 ' + $z.zone + '</div>'
                    if ($z.batches.Count -eq 0) {
                        $html += '<p style="color:#999;font-size:13px">（暂无）</p>'
                    } else {
                        foreach ($b in $z.batches) {
                            $pretty = $b.batch -replace '^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$', '$1-$2-$3 $4:$5'
                            $html += '<div style="font-size:14px;font-weight:700;margin:12px 0 4px;color:#1565C0">🕐 ' + [System.Net.WebUtility]::HtmlEncode($pretty) + '</div>'
                            $html += '<table><tr><th>年级 / 科目 / 学员</th><th>错题数</th></tr>'
                            foreach ($e in $b.entries) {
                                $html += '<tr><td>' + [System.Net.WebUtility]::HtmlEncode($e.path) + '</td><td>' + $e.count + '</td></tr>'
                            }
                            $html += '</table>'
                        }
                    }
                }
            }
            $html += '<h2>使用说明</h2><ul>'
            $html += '<li>📋 录入错题：选 年级/科目 → 填学员姓名 → 粘贴题目（每行一题）或点"📂 导入 .txt 文件" → 点"录入"即可，存入 <code>错题接收\发送\年级\学员名\错题.txt</code></li>'
            $html += '<li>📤 下发到平板：填学生姓名 → 选年级（可选）→ 点亮科目 → "🔍 加载错题" → 勾选题目 → "发送到平板"。平板 App"从电脑接收错题"→ 选同一学生 → "接收"即可拿到（发一次自动标记，不会重复收到）</li>'
            $html += '<li>平板 App：扫描入库 → 学员错题库 → 勾选错题 → 发送到电脑（发送时可切换年级），存入 <code>错题接收\接收\年级\学员名\错题.txt</code></li>'
            $html += '<li>每个学员的错题合并保存在同一 <code>错题.txt</code>，文件内按 语文 / 数学 / 英语 分类排列，重复题自动去重，可直接打开打印</li>'
            $html += '<li>填写 IP 见启动气泡提示；每个学员文件夹里的 <code>错题.txt</code> 可直接打开打印</li>'
            $html += '</ul></body></html>'
            Send-Response $stream '200 OK' 'text/html' $html
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/task-push') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            if ($null -eq $json -or [string]::IsNullOrEmpty($json.toName) -or ($null -eq $json.items -and $null -eq $json.hw)) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"toName or items missing"}'
            } else {
                $rec = [PSCustomObject]@{
                    toName = [string]$json.toName
                    toId   = if ($null -ne $json.toId) { [string]$json.toId } else { '' }
                    toGrade = if ($null -ne $json.toGrade) { [string]$json.toGrade } else { '' }
                    grade  = if ($null -ne $json.grade) { [string]$json.grade } else { '' }
                    subject = if ($null -ne $json.subject) { [string]$json.subject } else { '' }
                    type   = if ($null -ne $json.type) { [string]$json.type } else { 'items' }
                    from   = if ($null -ne $json.from) { [string]$json.from } else { '老师' }
                    sentAt = if ($null -ne $json.sentAt) { [string]$json.sentAt } else { (Get-Date).ToUniversalTime().ToString('o') }
                    items  = @($json.items)
                    hw     = $json.hw
                }
                $all = @()
                try {
                    if (Test-Path $taskFile) {
                        $parsed = [System.IO.File]::ReadAllText($taskFile) | ConvertFrom-Json
                        if ($null -ne $parsed) { $all = @($parsed) }
                    }
                } catch {}
                $all += $rec
                $keep = @()
                $counts = @{}
                for ($i = $all.Count - 1; $i -ge 0; $i--) {
                    $r = $all[$i]
                    if ($null -eq $r -or $null -eq $r.toName) { continue }
                    $key = [string]$r.toName
                    if (-not $counts.ContainsKey($key)) { $counts[$key] = 0 }
                    $counts[$key]++
                    if ($counts[$key] -gt 40) { continue }
                    $keep += $r
                }
                [array]::Reverse($keep)
                try {
                    [System.IO.File]::WriteAllText($taskFile, ($keep | ConvertTo-Json -Depth 8 -Compress), (New-Object System.Text.UTF8Encoding $false))
                } catch { Log ("写入任务缓存失败: {0}" -f $_.Exception.Message) }
                $n = if ($null -eq $json.items) { 0 } else { @($json.items).Count }
                Log ("局域网任务入队：→{0}（{1}）{2} 题" -f $rec.toName, $rec.from, $n)
                Send-Response $stream '200 OK' 'application/json' '{"ok":true}'
            }
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/tasks') {
            $name = ''
            if ($query -match '(?:^|&)name=([^&]+)') { $name = [System.Uri]::UnescapeDataString($Matches[1]) }
            $out = @()
            if ($name -and (Test-Path $taskFile)) {
                $needle = $name.Trim().ToLowerInvariant()
                try {
                    $parsed = [System.IO.File]::ReadAllText($taskFile) | ConvertFrom-Json
                    if ($null -ne $parsed) {
                        foreach ($r in @($parsed)) {
                            if ($null -eq $r -or $null -eq $r.toName) { continue }
                            if ([string]$r.toName -and ([string]$r.toName).Trim().ToLowerInvariant() -eq $needle) { $out += $r }
                        }
                    }
                } catch {}
            }
            $payload = @{ ok = $true; count = $out.Count; tasks = $out } | ConvertTo-Json -Depth 8 -Compress
            Send-Response $stream '200 OK' 'application/json' $payload
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/answer-push') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            if ($null -eq $json -or [string]::IsNullOrEmpty($json.taskId)) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"taskId missing"}'
            } else {
                $rec = [PSCustomObject]@{
                    name        = if ($null -ne $json.name) { [string]$json.name } else { '未知学员' }
                    studentId   = if ($null -ne $json.studentId) { [string]$json.studentId } else { '' }
                    grade       = if ($null -ne $json.grade) { [string]$json.grade } else { '' }
                    taskId      = [string]$json.taskId
                    subject     = if ($null -ne $json.subject) { [string]$json.subject } else { '' }
                    text        = if ($null -ne $json.text) { [string]$json.text } else { '' }
                    answer      = if ($null -ne $json.answer) { [string]$json.answer } else { '' }
                    myAnswer    = if ($null -ne $json.myAnswer) { [string]$json.myAnswer } else { '' }
                    correct     = if ($null -ne $json.correct) { [string]$json.correct } else { 'null' }
                    submittedAt = if ($null -ne $json.submittedAt) { [string]$json.submittedAt } else { (Get-Date).ToUniversalTime().ToString('o') }
                }
                $all = @()
                try {
                    if (Test-Path $answerFile) {
                        $parsed = [System.IO.File]::ReadAllText($answerFile) | ConvertFrom-Json
                        if ($null -ne $parsed) { $all = @($parsed) }
                    }
                } catch {}
                $all += $rec
                $keep = @()
                $counts = @{}
                for ($i = $all.Count - 1; $i -ge 0; $i--) {
                    $r = $all[$i]
                    if ($null -eq $r -or $null -eq $r.name) { continue }
                    $key = [string]$r.name
                    if (-not $counts.ContainsKey($key)) { $counts[$key] = 0 }
                    $counts[$key]++
                    if ($counts[$key] -gt 200) { continue }
                    $keep += $r
                }
                [array]::Reverse($keep)
                try {
                    [System.IO.File]::WriteAllText($answerFile, ($keep | ConvertTo-Json -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding $false))
                } catch { Log ("写入答案缓存失败: {0}" -f $_.Exception.Message) }
                Log ("答题结果入队：{0} → 题 {1}" -f $rec.name, $rec.taskId)
                Send-Response $stream '200 OK' 'application/json' '{"ok":true}'
            }
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/answers') {
            $out = @()
            try {
                if (Test-Path $answerFile) {
                    $parsed = [System.IO.File]::ReadAllText($answerFile) | ConvertFrom-Json
                    if ($null -ne $parsed) { $out = @($parsed) }
                }
            } catch {}
            Send-Response $stream '200 OK' 'application/json' (@{ ok = $true; count = $out.Count; answers = $out } | ConvertTo-Json -Depth 6 -Compress)
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/graded-answers') {
            $gradedFile = Join-Path $PSScriptRoot '批阅结果.json'
            $name = ''
            if ($query -match '(?:^|&)name=([^&]+)') { $name = [System.Uri]::UnescapeDataString($Matches[1]) }
            $out = @()
            try {
                if (Test-Path $gradedFile) {
                    $parsed = [System.IO.File]::ReadAllText($gradedFile) | ConvertFrom-Json
                    if ($null -ne $parsed) {
                        foreach ($r in @($parsed)) {
                            if ($null -eq $r) { continue }
                            if (-not $name -or ([string]$r.name).Trim().ToLowerInvariant() -eq $name.Trim().ToLowerInvariant()) { $out += $r }
                        }
                    }
                }
            } catch {}
            Send-Response $stream '200 OK' 'application/json' (@{ ok = $true; count = $out.Count; graded = $out } | ConvertTo-Json -Depth 6 -Compress)
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/report-push') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            if ($null -eq $json -or [string]::IsNullOrEmpty([string]$json.deviceId)) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"deviceId missing"}'
            } else {
                $rec = [PSCustomObject]@{
                    deviceId  = [string]$json.deviceId
                    name      = if ($null -ne $json.name) { [string]$json.name } else { '未知学员' }
                    grade     = if ($null -ne $json.grade) { [string]$json.grade } else { '' }
                    updatedAt = if ($null -ne $json.updatedAt) { [string]$json.updatedAt } else { (Get-Date).ToUniversalTime().ToString('o') }
                    stats     = $json.stats
                }
                $all = @()
                try {
                    if (Test-Path $reportFile) {
                        $parsed = [System.IO.File]::ReadAllText($reportFile) | ConvertFrom-Json
                        if ($null -ne $parsed) { $all = @($parsed) }
                    }
                } catch {}
                $all = @($all | Where-Object { $null -eq $_ -or $null -eq $_.deviceId -or [string]$_.deviceId -ne $rec.deviceId })
                $all += $rec
                try {
                    [System.IO.File]::WriteAllText($reportFile, ($all | ConvertTo-Json -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding $false))
                } catch { Log ("写入上报缓存失败: {0}" -f $_.Exception.Message) }
                Log ("学习情况入队：{0}（{1}）" -f $rec.name, $rec.deviceId)
                Send-Response $stream '200 OK' 'application/json' '{"ok":true}'
            }
        }
        elseif ($method -eq 'GET' -and $pathOnly -eq '/reports') {
            $out = @()
            try {
                if (Test-Path $reportFile) {
                    $parsed = [System.IO.File]::ReadAllText($reportFile) | ConvertFrom-Json
                    if ($null -ne $parsed) { $out = @($parsed) }
                }
            } catch {}
            Send-Response $stream '200 OK' 'application/json' (@{ ok = $true; count = $out.Count; reports = $out } | ConvertTo-Json -Depth 6 -Compress)
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/grade-answers') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            if ($null -eq $json -or [string]::IsNullOrEmpty([string]$json.student)) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"student missing"}'
            } else {
                $student = [string]$json.student
                $grade = if ($null -ne $json.grade) { [string]$json.grade } else { '' }
                $items = @()
                if ($null -ne $json.items) { $items = @($json.items) }
                $ids = @{}
                foreach ($it in $items) { if ($null -ne $it -and $null -ne $it.taskId) { $ids[[string]$it.taskId] = $true } }
                $removed = 0
                $all = @()
                try {
                    if (Test-Path $answerFile) {
                        $parsed = [System.IO.File]::ReadAllText($answerFile) | ConvertFrom-Json
                        if ($null -ne $parsed) { $all = @($parsed) }
                    }
                } catch {}
                $keep = @()
                foreach ($r in $all) {
                    if ($null -eq $r) { continue }
                    if ([string]$r.name -eq $student -and $ids.ContainsKey([string]$r.taskId)) { $removed++ }
                    else { $keep += $r }
                }
                try {
                    [System.IO.File]::WriteAllText($answerFile, ($keep | ConvertTo-Json -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding $false))
                } catch { Log ("删除答案缓存失败: {0}" -f $_.Exception.Message) }
                $gradedFile = Join-Path $PSScriptRoot '批阅结果.json'
                $graded = @()
                try {
                    if (Test-Path $gradedFile) {
                        $gp = [System.IO.File]::ReadAllText($gradedFile) | ConvertFrom-Json
                        if ($null -ne $gp) { $graded = @($gp) }
                    }
                } catch {}
                $graded = @($graded | Where-Object { $null -eq $_ -or [string]$_.name -ne $student })
                foreach ($git in $items) {
                    if ($null -eq $git) { continue }
                    $graded += [PSCustomObject]@{
                        name       = $student
                        grade      = $grade
                        taskId     = if ($null -ne $git.taskId) { [string]$git.taskId } else { '' }
                        subject    = if ($null -ne $git.subject) { [string]$git.subject } else { '' }
                        text       = if ($null -ne $git.text) { [string]$git.text } else { '' }
                        myAnswer   = if ($null -ne $git.myAnswer) { [string]$git.myAnswer } else { '' }
                        answer     = if ($null -ne $git.answer) { [string]$git.answer } else { '' }
                        correct    = if ($null -ne $git.correct) { [string]$git.correct } else { 'null' }
                        gradedAt   = (Get-Date).ToUniversalTime().ToString('o')
                    }
                }
                try {
                    [System.IO.File]::WriteAllText($gradedFile, ($graded | ConvertTo-Json -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding $false))
                } catch { Log ("写入批阅结果失败: {0}" -f $_.Exception.Message) }
                $safeName = [regex]::Replace($student, '[\\/:*?"<>|\r\n]', '_')
                $repDir = Join-Path $PSScriptRoot (('学情接收\{0}年级\{1}' -f $grade, $safeName))
                try { New-Item -ItemType Directory -Path $repDir -Force | Out-Null } catch {}
                $repFile = Join-Path $repDir '学情报告.txt'
                $lines = New-Object System.Collections.Generic.List[string]
                $lines.Add('════════════════════════════════════════')
                $lines.Add(('学员：{0}（{1}年级）　评分归档：{2}' -f $student, $grade, (Get-Date).ToString('yyyy-MM-dd HH:mm')))
                $lines.Add('────────────────────────────────────────')
                $okCnt = 0
                for ($idx = 0; $idx -lt $items.Count; $idx++) {
                    $it = $items[$idx]
                    if ($null -eq $it) { continue }
                    $txt = if ($null -ne $it.text) { [string]$it.text } else { '' }
                    $my = if ($null -ne $it.myAnswer) { [string]$it.myAnswer } else { '' }
                    $ans = if ($null -ne $it.answer) { [string]$it.answer } else { '' }
                    $cor = if ($null -ne $it.correct) { [string]$it.correct } else { 'null' }
                    $isOk = ($cor -eq 'True' -or $cor -eq 'true' -or $cor -eq '1')
                    if ($isOk) { $okCnt++ }
                    $mark = if ($isOk) { '✅' } else { '❌' }
                    $lines.Add(('{0} {1}. {2}' -f $mark, ($idx + 1), $txt))
                    $lines.Add(('　　我的答案：{0}{1}' -f $my, $(if (-not $isOk -and $ans) { '　标准答案：' + $ans } else { '' })))
                }
                $lines.Add('────────────────────────────────────────')
                $total = $items.Count
                $rate = if ($total -gt 0) { [Math]::Round($okCnt * 100 / $total) } else { 0 }
                $lines.Add(('本次得分：{0}/{1}　正确率 {2}%' -f $okCnt, $total, $rate))
                $lines.Add('')
                $newTxt = $lines -join "`r`n"
                try {
                    $old = ''
                    if (Test-Path $repFile) { $old = [System.IO.File]::ReadAllText($repFile) }
                    [System.IO.File]::WriteAllText($repFile, ($old + $newTxt), (New-Object System.Text.UTF8Encoding $true))
                } catch { Log ("写入学情报告失败: {0}" -f $_.Exception.Message) }
                Log ("评分归档：{0}（{1}年级）{2} 题，删除 {3} 条缓存" -f $student, $grade, $items.Count, $removed)
                Send-Response $stream '200 OK' 'application/json' (@{ ok = $true; removed = $removed; archived = $items.Count } | ConvertTo-Json -Compress)
            }
        }
        elseif ($method -eq 'POST' -and $pathOnly -eq '/grade-report') {
            $body = Read-Body $stream $contentLength
            $json = $null
            try { $json = $body | ConvertFrom-Json } catch {}
            if ($null -eq $json -or [string]::IsNullOrEmpty([string]$json.deviceId)) {
                Send-Response $stream '400 Bad Request' 'application/json' '{"ok":false,"err":"deviceId missing"}'
            } else {
                $student = [string]$json.student
                $grade = if ($null -ne $json.grade) { [string]$json.grade } else { '' }
                $removed = 0
                $all = @()
                try {
                    if (Test-Path $reportFile) {
                        $parsed = [System.IO.File]::ReadAllText($reportFile) | ConvertFrom-Json
                        if ($null -ne $parsed) { $all = @($parsed) }
                    }
                } catch {}
                $keep = @()
                foreach ($r in $all) {
                    if ($null -eq $r) { continue }
                    if ([string]$r.deviceId -eq [string]$json.deviceId) { $removed++ }
                    else { $keep += $r }
                }
                try {
                    [System.IO.File]::WriteAllText($reportFile, ($keep | ConvertTo-Json -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding $false))
                } catch { Log ("删除上报缓存失败: {0}" -f $_.Exception.Message) }
                $safeName = [regex]::Replace($student, '[\\/:*?"<>|\r\n]', '_')
                $repDir = Join-Path $PSScriptRoot (('学情接收\{0}年级\{1}' -f $grade, $safeName))
                try { New-Item -ItemType Directory -Path $repDir -Force | Out-Null } catch {}
                $repFile = Join-Path $repDir '学情报告.txt'
                $lines = New-Object System.Collections.Generic.List[string]
                $lines.Add('════════════════════════════════════════')
                $lines.Add(('学员：{0}（{1}年级）　评分归档：{2}' -f $student, $grade, (Get-Date).ToString('yyyy-MM-dd HH:mm')))
                $lines.Add('────────────────────────────────────────')
                $st = if ($null -ne $json.stats) { $json.stats } else { $null }
                if ($null -ne $st) {
                    $lines.Add(('⚡ 积分 {0}　Lv.{1}　⭐ 星星 {2}' -f $st.xp, $st.level, $st.stars))
                    $lines.Add(('📖 已学 {0} 词　📚 {1} 课时　🔥 {2} 天连续' -f $st.wordsLearned, $st.lessons, $st.streak))
                    $lines.Add(('⏱ 学习时长 {0} 分钟　❌ 错题 {1}' -f $st.minutes, $st.wrongs))
                    Add-SubjectReportLines $lines $st
                    $md = Format-MonthDay $st.lastPractice
                    if ($md) { $lines.Add(('最近练习：{0}' -f $md)) }
                } else {
                    $lines.Add('学习情况：无详细数据')
                }
                $lines.Add('')
                $newTxt = $lines -join "`r`n"
                try {
                    $old = ''
                    if (Test-Path $repFile) { $old = [System.IO.File]::ReadAllText($repFile) }
                    [System.IO.File]::WriteAllText($repFile, ($old + $newTxt), (New-Object System.Text.UTF8Encoding $true))
                } catch { Log ("写入学情报告失败: {0}" -f $_.Exception.Message) }
                Log ("评分归档学情：{0}（{1}年级），删除 {2} 条上报缓存" -f $student, $grade, $removed)
                Send-Response $stream '200 OK' 'application/json' (@{ ok = $true; removed = $removed } | ConvertTo-Json -Compress)
            }
        }
        else {
            Send-Response $stream '404 Not Found' 'text/plain' '404'
        }
        $stream.Close()
        $client.Close()
    } catch {
        Log ("处理请求出错: {0}" -f $_.Exception.Message)
        try { $client.Close() } catch {}
    }
}

# ---------- 防火墙自动放行（首次运行提权一次，之后不再弹窗） ----------
function Ensure-FirewallRule {
    $marker = Join-Path $env:APPDATA 'wj8899_fw_ok.txt'
    if (Test-Path $marker) { return }
    $tcpOk = $false
    $udpOk = $false
    try {
        & netsh advfirewall firewall add rule name=wj8899 dir=in action=allow protocol=TCP localport=8899 2>$null | Out-Null
        $tcpOk = ($LASTEXITCODE -eq 0)
        & netsh advfirewall firewall add rule name=wj8899udp dir=in action=allow protocol=UDP localport=8899 2>$null | Out-Null
        $udpOk = ($LASTEXITCODE -eq 0)
    } catch {}
    if ($tcpOk -and $udpOk) {
        try { New-Item -ItemType File -Path $marker -Force | Out-Null } catch {}
        Log '防火墙：8899 入站已放行'
        return
    }
    try {
        $inner = "netsh advfirewall firewall delete rule name=wj8899 2>`$null | Out-Null; netsh advfirewall firewall delete rule name=wj8899udp 2>`$null | Out-Null; netsh advfirewall firewall add rule name=wj8899 dir=in action=allow protocol=TCP localport=8899 | Out-Null; netsh advfirewall firewall add rule name=wj8899udp dir=in action=allow protocol=UDP localport=8899 | Out-Null; New-Item -ItemType File -Path '$marker' -Force | Out-Null"
        Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command', $inner -ErrorAction Stop
        Log '防火墙：8899 入站已放行（首次运行需在弹窗中点“是”）'
    } catch {
        Log '防火墙：未放行 8899 入站（平板可能无法自动更新，请以管理员运行一次）'
    }
}
Ensure-FirewallRule

# ---------- 启动监听 ----------
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
try {
    $listener.Start(5000)
} catch {
    $msg = "端口 $port 已被占用（可能接收器已在运行）。`n请先退出旧的接收器再启动。"
    Log $msg
    try {
        [System.Windows.Forms.MessageBox]::Show($msg, '错题接收发送器', 'OK', 'Warning') | Out-Null
    } catch {}
    exit 1
}

# ---------- 云端监听 ----------
$cloudUrl = 'https://ntfy.sh/pjyx-wrong-pjj250412'
$cloudProg = Join-Path $PSScriptRoot '云端进度.txt'
$cloudBatches = New-Object 'System.Collections.Concurrent.ConcurrentDictionary[int,object]'
$nextCloud = (Get-Date)

# ---------- 云端批阅补拉（电脑接收器关闭期间老师评分归档走云端，开启后自动补写学情报告） ----------
$gradedUrl = 'https://ntfy.sh/pjyx-answer-pjj250412'
$nextGraded = (Get-Date)

# ---------- 设备授权表（重装平板后用于电脑端恢复授权，避免云端记录过期） ----------
$claimsUrl = 'https://ntfy.sh/pjyx-claim-pjjy250412'
$authFile = Join-Path $PSScriptRoot '设备授权.json'
$nextClaims = (Get-Date).AddSeconds(15)

$ips = Get-LocalIPs
$ipLine = if ($ips.Count -gt 0) { ($ips | ForEach-Object { "http://$_`:$port" }) -join '  ' } else { '未能获取本机 IP，请用 ipconfig 查看' }
Log "错题接收发送器已启动，局域网地址：$ipLine"
Log '更新服务：平板 App 自动从 http://<本机IP>:8899/check 检查并拉取新版 JS（更新目录：更新\）'
Log '右键托盘图标可打开文件夹/统计页/设置开机自启/退出'

# ---------- 系统托盘 ----------
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Text = '错题接收发送器（运行中）'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenu
$itemFolder = $menu.MenuItems.Add('📂 打开错题文件夹')
$itemFolder.add_Click({ Start-Process explorer.exe -ArgumentList "`"$baseDir`"" })
$itemPage = $menu.MenuItems.Add('🌐 打开统计页')
$itemPage.add_Click({ Start-Process "http://127.0.0.1:$port/" })
$menu.MenuItems.Add('-') | Out-Null

$startupDir = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startupDir '错题接收发送器.lnk'
$itemAuto = $menu.MenuItems.Add('⏰ 开机自动启动')
function Update-AutoText {
    $script:itemAuto.Text = if (Test-Path $lnkPath) { '⏰ 开机自动启动（已开启）' } else { '⏰ 开机自动启动（未开启）' }
}
$itemAuto.add_Click({
    if (Test-Path $lnkPath) {
        Remove-Item $lnkPath -Force
        Log '已关闭开机自启'
    } else {
        try {
            $ws = New-Object -ComObject WScript.Shell
            $sc = $ws.CreateShortcut($lnkPath)
            $sc.TargetPath = 'cmd.exe'
            $sc.Arguments = "/c start `"`" /min `"$PSScriptRoot\start.bat`""
            $sc.WorkingDirectory = $PSScriptRoot
            $sc.Description = '错题接收发送器（守护模式，开机自动运行）'
            $sc.Save()
            Log '已开启开机自启'
        } catch {
            Log ("开机自启设置失败: {0}" -f $_.Exception.Message)
        }
    }
    Update-AutoText
})
$menu.MenuItems.Add('-') | Out-Null
$itemExit = $menu.MenuItems.Add('✖ 退出接收器（含守护）')
$itemExit.add_Click({
    try { [System.IO.File]::WriteAllText($stopFlag, '1') } catch {}
    $timer.Stop()
    $notify.Visible = $false
    $notify.Dispose()
    Log '接收器已退出（守护已停止）'
    [System.Windows.Forms.Application]::Exit()
})
$notify.ContextMenu = $menu
Update-AutoText
try {
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnkPath)
    $oldTarget = $sc.TargetPath
    $oldArgs = $sc.Arguments
    $newArgs = "/c start `"`" /min `"$PSScriptRoot\start.bat`""
    if ($oldTarget -ne 'cmd.exe' -or $oldArgs -ne $newArgs) {
        $sc.TargetPath = 'cmd.exe'
        $sc.Arguments = $newArgs
        $sc.WorkingDirectory = $PSScriptRoot
        $sc.Description = '错题接收发送器（守护模式，开机自动运行）'
        $sc.Save()
        Log "已自动更新开机自启快捷方式（$PSScriptRoot）"
    }
} catch {}

# ---------- 退出停止标记（守护不再拉起） ----------
$stopFlag = Join-Path $PSScriptRoot '停止守护.flag'

# ---------- 主循环（定时器） ----------
$nextScan = (Get-Date)
$nextCloudSync = (Get-Date).AddSeconds(20)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.add_Tick({
    try {
    $swT = New-Object System.Diagnostics.Stopwatch
    $swT.Start()
    while ($listener.Pending()) {
        try { Handle-Http } catch { Log ("处理请求出错: {0}" -f $_.Exception.Message) }
    }
    if ((Get-Date) -ge $script:nextCloud) {
        $ok = $false
        try { $ok = Invoke-CloudOnce } catch {}
        if ($ok) { $script:nextCloud = (Get-Date).AddSeconds(10) } else { $script:nextCloud = (Get-Date).AddSeconds(120) }
        Log ("云端检查结束 ok={0} 下次+{1}s" -f $ok, $(if ($ok) { 10 } else { 120 }))
    }
    if ((Get-Date) -ge $script:nextCloudSync) {
        try { Sync-CloudUpdateDir } catch { Log ("云端同步异常: {0}" -f $_.Exception.Message) }
        try { Sync-SelfUpdate } catch { Log ("自举更新异常: {0}" -f $_.Exception.Message) }
        $script:nextCloudSync = (Get-Date).AddMinutes(10)
    }
    if ((Get-Date) -ge $script:nextGraded) {
        $ok2 = $false
        try { $ok2 = Invoke-GradedOnce } catch {}
        if ($ok2) { $script:nextGraded = (Get-Date).AddSeconds(15) } else { $script:nextGraded = (Get-Date).AddSeconds(120) }
        Log ("云端批阅检查结束 ok={0} 下次+{1}s" -f $ok2, $(if ($ok2) { 15 } else { 120 }))
    }
    if ((Get-Date) -ge $script:nextClaims) {
        try { Start-ClaimsJob } catch {}
        $script:nextClaims = (Get-Date).AddSeconds(60)
    }
    try { Check-AiJobs } catch { Log ("AI任务检查异常: {0}" -f $_.Exception.Message) }
    # APK 下载任务回收（60s 超时）
    foreach ($aj in @($Script:apkJobs)) {
        if ($aj.handle.IsCompleted -or ((Get-Date) - $aj.start).TotalSeconds -gt 60) {
            try { if (-not $aj.handle.IsCompleted) { $aj.handle.Stop() } } catch {}
            try { $null = $aj.ps.EndInvoke($aj.handle) } catch {}
            try { $aj.ps.Dispose() } catch {}
            try { $aj.rs.Close() } catch {}
            $Script:apkJobs = @($Script:apkJobs | Where-Object { $_ -ne $aj })
        }
    }
    if ((Get-Date) -ge $script:nextScan) {
        $script:nextScan = (Get-Date).AddSeconds(5)
        try { Scan-DropFolders } catch { Log ("扫描文件夹异常: {0}" -f $_.Exception.Message) }
    }
    $swT.Stop()
    if ($swT.ElapsedMilliseconds -gt 500) { Log ("tick 总耗时: {0}ms" -f $swT.ElapsedMilliseconds) }
    } catch { Log ("tick 异常: {0}" -f $_.Exception.Message) }
})
$timer.Start()

Log '文件夹自动导入/下发监控已启动（每 5 秒扫描 自动导入\ 与 待下发\）'
Scan-DropFolders
try { Migrate-LegacyLayout } catch { Log ("旧目录迁移异常: {0}" -f $_.Exception.Message) }

try {
    $notify.ShowBalloonTip(5000, '错题接收发送器已启动', "平板可发送错题到：$ipLine", 'Info')
} catch {}

[System.Windows.Forms.Application]::Run()
