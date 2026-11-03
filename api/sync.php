<?php
/*
 * api/sync.php  同期用API（複数端末でのデータ共有）
 *
 * 同期コードごとに、データ（JSON）を1つのファイルとして保存するだけの単純な保管庫。
 * データの合わせ方（マージ）は端末側（js/sync.js）で行い、ここでは版数（version）で
 * 書き込みの衝突だけを防ぐ（楽観的ロック）。
 *
 * リクエスト：POST、本文は JSON
 *   { "action": "get",    "code": "ABCD-EFGH-JKLM-NPQR" }
 *   { "action": "put",    "code": "...", "baseVersion": 3, "data": { ... } }
 *   { "action": "delete", "code": "..." }
 * レスポンス：JSON
 *   get    → 200 { version, updatedAt, data } ／ 404 { version: 0 }
 *   put    → 200 { version, updatedAt } ／ 409 { error: "conflict", version, data }（他の端末が先に書き込んだ）
 *   delete → 200 { deleted: true }
 *
 * 保存先：../data/sync/<同期コードのハッシュ>.json（data/.htaccess でWebから直接読めないようにしている）
 * 同期コードはファイル名に使わずハッシュにするので、保存先のファイル名からコードは分からない。
 */

declare(strict_types=1);

const MAX_BODY_BYTES = 4194304;           // 4MB（文字だけなら数十KB。アイコン画像は1枚数KB〜40KB）
const CODE_PATTERN = '/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/';
const HASH_SALT = 'kaikei-smooth-sync-v1:';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['error' => 'method_not_allowed']);
}

$raw = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
if ($raw === false || strlen($raw) > MAX_BODY_BYTES) {
    respond(413, ['error' => 'too_large']);
}

$req = json_decode($raw, true);
if (!is_array($req)) {
    respond(400, ['error' => 'bad_json']);
}

$action = $req['action'] ?? '';
$code = strtoupper(trim((string)($req['code'] ?? '')));
if (!preg_match(CODE_PATTERN, $code)) {
    respond(400, ['error' => 'bad_code']);
}

$dir = dirname(__DIR__) . '/data/sync';
if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
    respond(500, ['error' => 'storage_unavailable']);
}
$file = $dir . '/' . hash('sha256', HASH_SALT . $code) . '.json';

/** 保存されている内容を読む（なければ null） */
function readStore(string $file): ?array
{
    if (!is_file($file)) {
        return null;
    }
    $json = file_get_contents($file);
    $store = is_string($json) ? json_decode($json, true) : null;
    return is_array($store) ? $store : null;
}

/** 端末から送られたデータの形をざっと確かめる */
function validData($data): bool
{
    if (!is_array($data)) {
        return false;
    }
    foreach (['apps', 'points', 'shops', 'launchHistory'] as $key) {
        if (isset($data[$key]) && !is_array($data[$key])) {
            return false;
        }
    }
    if (isset($data['tombstones']) && !is_array($data['tombstones'])) {
        return false;
    }
    return true;
}

switch ($action) {
    case 'get':
        $store = readStore($file);
        if ($store === null) {
            respond(404, ['version' => 0]);
        }
        respond(200, [
            'version' => (int)($store['version'] ?? 0),
            'updatedAt' => $store['updatedAt'] ?? null,
            'data' => $store['data'] ?? new stdClass(),
        ]);

    case 'put':
        $data = $req['data'] ?? null;
        $base = $req['baseVersion'] ?? null;
        if (!is_int($base) || $base < 0 || !validData($data)) {
            respond(400, ['error' => 'bad_request']);
        }
        $fp = fopen($file, 'c+');
        if ($fp === false) {
            respond(500, ['error' => 'storage_unavailable']);
        }
        try {
            flock($fp, LOCK_EX);
            $current = stream_get_contents($fp);
            $store = $current ? json_decode($current, true) : null;
            $version = is_array($store) ? (int)($store['version'] ?? 0) : 0;
            if ($version !== $base) {
                respond(409, [
                    'error' => 'conflict',
                    'version' => $version,
                    'data' => is_array($store) ? ($store['data'] ?? new stdClass()) : new stdClass(),
                ]);
            }
            $next = [
                'version' => $version + 1,
                'updatedAt' => gmdate('Y-m-d\TH:i:s\Z'),
                'data' => $data,
            ];
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($next, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            fflush($fp);
            respond(200, ['version' => $next['version'], 'updatedAt' => $next['updatedAt']]);
        } finally {
            flock($fp, LOCK_UN);
            fclose($fp);
        }

    case 'delete':
        if (is_file($file)) {
            unlink($file);
        }
        respond(200, ['deleted' => true]);

    default:
        respond(400, ['error' => 'bad_action']);
}
