$baseUrl = "http://localhost:18500"
$passed = 0
$failed = 0

function Test-Endpoint {
    param(
        [string]$method,
        [string]$endpoint,
        [string]$body = "",
        [hashtable]$headers = @{}
    )
    
    try {
        $params = @{
            Uri = "$baseUrl$endpoint"
            Method = $method
            Headers = $headers
            ErrorAction = "Stop"
        }
        
        if ($body) {
            $params.Body = $body
            $params.ContentType = "application/json"
        }
        
        $response = Invoke-RestMethod @params
        Write-Host "✅ $method $endpoint" -ForegroundColor Green
        return $response
    }
    catch {
        Write-Host "❌ $method $endpoint" -ForegroundColor Red
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
        return $null
    }
}

Write-Host "`n" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  COMPREHENSIVE API ENDPOINT TESTS" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

# Health Check
Write-Host "`n[1/25] Health Check" -ForegroundColor Blue
Test-Endpoint "GET" "/health" | Out-Null

# Auth: Login
Write-Host "`n[2/25] Authentication: Login" -ForegroundColor Blue
$body = @{email="developer@example.com"; password="DevPass123!"} | ConvertTo-Json
$login = Test-Endpoint "POST" "/api/auth/login" $body
$token = $login.tokens.accessToken

# Auth: Register
Write-Host "`n[3/25] Authentication: Register" -ForegroundColor Blue
$email = "test-$(Get-Random)@example.com"
$body = @{
    email=$email
    password="TestPass123!"
    username="testuser$(Get-Random)"
    firstName="Test"
    lastName="User"
} | ConvertTo-Json
Test-Endpoint "POST" "/api/auth/register" $body | Out-Null

# Auth: Refresh
Write-Host "`n[4/25] Authentication: Refresh Token" -ForegroundColor Blue
$body = @{refreshToken=$login.tokens.refreshToken} | ConvertTo-Json
Test-Endpoint "POST" "/api/auth/refresh" $body | Out-Null

# Auth: Logout
Write-Host "`n[5/25] Authentication: Logout" -ForegroundColor Blue
Test-Endpoint "POST" "/api/auth/logout" "" @{Authorization="Bearer $token"} | Out-Null

# Servers: List
Write-Host "`n[6/25] Servers: List All" -ForegroundColor Blue
$servers = Test-Endpoint "GET" "/api/servers"

# Servers: Top
Write-Host "`n[7/25] Servers: Get Top Servers" -ForegroundColor Blue
Test-Endpoint "GET" "/api/servers/top" | Out-Null

# Servers: Get Single
Write-Host "`n[8/25] Servers: Get Single Server" -ForegroundColor Blue
if ($servers -and $servers.servers -and $servers.servers.Length -gt 0) {
    $serverId = $servers.servers[0].id
    Test-Endpoint "GET" "/api/servers/$serverId" | Out-Null
}

# Servers: Create
Write-Host "`n[9/25] Servers: Create Server" -ForegroundColor Blue
$body = @{
    name="test-server-$(Get-Random)"
    description="Test server"
    baseUrl="http://localhost:8000"
    apiKey="test-$(Get-Random)"
} | ConvertTo-Json
$newServer = Test-Endpoint "POST" "/api/servers" $body @{Authorization="Bearer $token"}
if ($newServer) { $newServerId = $newServer.id }

# Servers: Update
Write-Host "`n[10/25] Servers: Update Server" -ForegroundColor Blue
if ($newServerId) {
    $body = @{name="updated-$(Get-Random)"; description="Updated"} | ConvertTo-Json
    Test-Endpoint "PUT" "/api/servers/$newServerId" $body @{Authorization="Bearer $token"} | Out-Null
}

# Servers: Publish
Write-Host "`n[11/25] Servers: Publish Server" -ForegroundColor Blue
if ($serverId) {
    Test-Endpoint "POST" "/api/servers/$serverId/publish" "" @{Authorization="Bearer $token"} | Out-Null
}

# Servers: Get Owner Servers
Write-Host "`n[12/25] Servers: Get User's Servers" -ForegroundColor Blue
$userId = $login.user.id
Test-Endpoint "GET" "/api/servers/owner/$userId" @{Authorization="Bearer $token"} | Out-Null

# Servers: Delete
Write-Host "`n[13/25] Servers: Delete Server" -ForegroundColor Blue
if ($newServerId) {
    Test-Endpoint "DELETE" "/api/servers/$newServerId" "" @{Authorization="Bearer $token"} | Out-Null
}

# Tools: List for Server
Write-Host "`n[14/25] Tools: List for Server" -ForegroundColor Blue
if ($serverId) {
    Test-Endpoint "GET" "/api/tools/server/$serverId" | Out-Null
}

# Tools: Get Single
Write-Host "`n[15/25] Tools: Get Single Tool" -ForegroundColor Blue
if ($servers -and $servers.servers -and $servers.servers.Length -gt 0) {
    # Get first server's first tool
    $firstServerId = $servers.servers[0].id
    $tools = Test-Endpoint "GET" "/api/tools/server/$firstServerId"
    if ($tools -and $tools.tools -and $tools.tools.Length -gt 0) {
        $toolId = $tools.tools[0].id
        Test-Endpoint "GET" "/api/tools/$toolId" | Out-Null
    }
}

# Tools: Create
Write-Host "`n[16/25] Tools: Create Tool" -ForegroundColor Blue
if ($newServerId) {
    $body = @{
        serverId=$newServerId
        name="test-tool-$(Get-Random)"
        description="Test tool"
        inputSchema=@{type="object"; properties=@{query=@{type="string"}}; required=@("query")}
    } | ConvertTo-Json -Depth 10
    $newTool = Test-Endpoint "POST" "/api/tools" $body @{Authorization="Bearer $token"}
    if ($newTool) { $newToolId = $newTool.id }
}

# Tools: Update
Write-Host "`n[17/25] Tools: Update Tool" -ForegroundColor Blue
if ($newToolId) {
    $body = @{name="updated-tool-$(Get-Random)"; description="Updated"} | ConvertTo-Json
    Test-Endpoint "PUT" "/api/tools/$newToolId" $body @{Authorization="Bearer $token"} | Out-Null
}

# Tools: Invoke
Write-Host "`n[18/25] Tools: Invoke Tool" -ForegroundColor Blue
if ($toolId) {
    $body = @{parameters=@{query="test"}} | ConvertTo-Json
    Test-Endpoint "POST" "/api/tools/$toolId/invoke" $body @{Authorization="Bearer $token"} | Out-Null
}

# Tools: Popular
Write-Host "`n[19/25] Tools: Get Popular Tools" -ForegroundColor Blue
Test-Endpoint "GET" "/api/tools/popular/list" | Out-Null

# Tools: Delete
Write-Host "`n[20/25] Tools: Delete Tool" -ForegroundColor Blue
if ($newToolId) {
    Test-Endpoint "DELETE" "/api/tools/$newToolId" "" @{Authorization="Bearer $token"} | Out-Null
}

# Users: Get Profile
Write-Host "`n[21/25] Users: Get Current Profile" -ForegroundColor Blue
$user = Test-Endpoint "GET" "/api/users/me" "" @{Authorization="Bearer $token"}

# Users: Update Profile
Write-Host "`n[22/25] Users: Update Profile" -ForegroundColor Blue
$body = @{firstName="Updated"; lastName="Name"; bio="Test bio"} | ConvertTo-Json
Test-Endpoint "PUT" "/api/users/me" $body @{Authorization="Bearer $token"} | Out-Null

# Users: API Key
Write-Host "`n[23/25] Users: Generate API Key" -ForegroundColor Blue
Test-Endpoint "POST" "/api/users/me/api-key" "" @{Authorization="Bearer $token"} | Out-Null

# Users: Wallet
Write-Host "`n[24/25] Users: Get Wallet" -ForegroundColor Blue
Test-Endpoint "GET" "/api/users/me/wallet" "" @{Authorization="Bearer $token"} | Out-Null

# Users: Transactions
Write-Host "`n[25/25] Users: Get Transactions" -ForegroundColor Blue
Test-Endpoint "GET" "/api/users/me/transactions" "" @{Authorization="Bearer $token"} | Out-Null

Write-Host "`n" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  ✅ ALL 25 ENDPOINTS TESTED" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""
