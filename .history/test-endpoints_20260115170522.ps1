# Complete API Endpoint Test Suite
# Tests all 25 endpoints with comprehensive validation

$baseUrl = "http://localhost:18500"
$results = @()

# Color output helper
function Write-TestResult {
    param(
        [string]$endpoint,
        [string]$method,
        [string]$status,
        [string]$result
    )
    
    $color = if ($status -eq "✅") { "Green" } elseif ($status -eq "⚠️") { "Yellow" } else { "Red" }
    Write-Host "$status $method $endpoint" -ForegroundColor $color
    if ($result) { Write-Host "   $result" -ForegroundColor Gray }
    
    $results += @{
        Endpoint = $endpoint
        Method = $method
        Status = $status
        Result = $result
    }
}

# Test helper
function Test-Endpoint {
    param(
        [string]$method,
        [string]$endpoint,
        [object]$body = $null,
        [hashtable]$headers = @{},
        [string]$description = ""
    )
    
    try {
        $url = "$baseUrl$endpoint"
        $params = @{
            Uri = $url
            Method = $method
            Headers = $headers
            ErrorAction = "Stop"
        }
        
        if ($body) {
            $params.Body = ($body | ConvertTo-Json -Depth 10)
            $params.ContentType = "application/json"
        }
        
        $response = Invoke-RestMethod @params
        Write-TestResult $endpoint $method "✅" "Status 200 OK"
        return $response
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.Value__
        $errorMsg = if ($_.Exception.Response) {
            ($_.Exception.Response.Content | ConvertFrom-Json -ErrorAction SilentlyContinue).message
        } else {
            $_.Exception.Message
        }
        Write-TestResult $endpoint $method "❌" "Status $statusCode - $errorMsg"
        return $null
    }
}

Write-Host "`n📋 COMPREHENSIVE API ENDPOINT TEST SUITE" -ForegroundColor Cyan
Write-Host "Base URL: $baseUrl`n" -ForegroundColor Cyan

# ===== HEALTH CHECK (1/25) =====
Write-Host "`n🔵 HEALTH CHECK" -ForegroundColor Blue
Test-Endpoint "GET" "/health"

# ===== AUTHENTICATION ENDPOINTS (4/25) =====
Write-Host "`n🔵 AUTHENTICATION ENDPOINTS (4)" -ForegroundColor Blue

# Register new user
$registerUser = @{
    email = "testuser-$(Get-Random)@example.com"
    password = "TestPass123!"
    username = "testuser$(Get-Random)"
    firstName = "Test"
    lastName = "User"
}
$registerResponse = Test-Endpoint "POST" "/api/auth/register" $registerUser
$testUserEmail = $registerUser.email
$testUserPassword = $registerUser.password

# Login (use existing developer account)
$loginBody = @{
    email = "developer@example.com"
    password = "DevPass123!"
}
$loginResponse = Test-Endpoint "POST" "/api/auth/login" $loginBody
$token = $loginResponse.tokens.accessToken
$refreshToken = $loginResponse.tokens.refreshToken

Write-Host "   📝 Auth token acquired: $($token.Substring(0, 20))..." -ForegroundColor Gray
Write-Host "   📝 Refresh token acquired: $($refreshToken.Substring(0, 20))..." -ForegroundColor Gray

# Refresh token
$refreshBody = @{
    refreshToken = $refreshToken
}
Test-Endpoint "POST" "/api/auth/refresh" $refreshBody

# Logout
$headers = @{ Authorization = "Bearer $token" }
Test-Endpoint "POST" "/api/auth/logout" @{} -Headers $headers

# ===== SERVER ENDPOINTS (8/25) =====
Write-Host "`n🔵 SERVER MANAGEMENT ENDPOINTS (8)" -ForegroundColor Blue

# List servers
Test-Endpoint "GET" "/api/servers"

# Get top servers
Test-Endpoint "GET" "/api/servers/top"

# Get single server (use first from list)
Test-Endpoint "GET" "/api/servers/550e8400-e29b-41d4-a716-446655440001"

# Create server (requires DEVELOPER role)
$newServer = @{
    name = "test-server-$(Get-Random)"
    description = "Test server for validation"
    baseUrl = "http://localhost:8000"
    apiKey = "test-key-$(Get-Random)"
}
$createServerResponse = Test-Endpoint "POST" "/api/servers" $newServer -Headers @{ Authorization = "Bearer $token" }
$serverId = $createServerResponse.id

# Update server
if ($serverId) {
    $updateServer = @{
        name = "updated-server-$(Get-Random)"
        description = "Updated description"
    }
    Test-Endpoint "PUT" "/api/servers/$serverId" $updateServer -Headers @{ Authorization = "Bearer $token" }
}

# Publish server (move to ACTIVE status)
Test-Endpoint "POST" "/api/servers/550e8400-e29b-41d4-a716-446655440001/publish" @{} -Headers @{ Authorization = "Bearer $token" }

# Get user's servers
Test-Endpoint "GET" "/api/servers/owner/550e8400-e29b-41d4-a716-446655440000" -Headers @{ Authorization = "Bearer $token" }

# Delete server
if ($serverId) {
    Test-Endpoint "DELETE" "/api/servers/$serverId" -Headers @{ Authorization = "Bearer $token" }
}

# ===== TOOL ENDPOINTS (7/25) =====
Write-Host "`n🔵 TOOL MANAGEMENT ENDPOINTS (7)" -ForegroundColor Blue

# Get tools for server
Test-Endpoint "GET" "/api/tools/server/550e8400-e29b-41d4-a716-446655440001"

# Get single tool
Test-Endpoint "GET" "/api/tools/550e8400-e29b-41d4-a716-446655440010"

# Create tool
$newTool = @{
    serverId = "550e8400-e29b-41d4-a716-446655440001"
    name = "test-tool-$(Get-Random)"
    description = "Test tool"
    inputSchema = @{
        type = "object"
        properties = @{
            query = @{ type = "string" }
        }
        required = @("query")
    }
}
$createToolResponse = Test-Endpoint "POST" "/api/tools" $newTool -Headers @{ Authorization = "Bearer $token" }
$toolId = $createToolResponse.id

# Update tool
if ($toolId) {
    $updateTool = @{
        name = "updated-tool-$(Get-Random)"
        description = "Updated tool description"
    }
    Test-Endpoint "PUT" "/api/tools/$toolId" $updateTool -Headers @{ Authorization = "Bearer $token" }
}

# Invoke tool
$invokeBody = @{
    parameters = @{
        query = "test query"
    }
}
Test-Endpoint "POST" "/api/tools/550e8400-e29b-41d4-a716-446655440010/invoke" $invokeBody -Headers @{ Authorization = "Bearer $token" }

# Get popular tools
Test-Endpoint "GET" "/api/tools/popular/list"

# Delete tool
if ($toolId) {
    Test-Endpoint "DELETE" "/api/tools/$toolId" -Headers @{ Authorization = "Bearer $token" }
}

# ===== USER ENDPOINTS (6/25) =====
Write-Host "`n🔵 USER PROFILE ENDPOINTS (6)" -ForegroundColor Blue

# Get current user profile
Test-Endpoint "GET" "/api/users/me" -Headers @{ Authorization = "Bearer $token" }

# Update profile
$updateProfile = @{
    firstName = "Updated"
    lastName = "Name"
    bio = "Updated bio"
}
Test-Endpoint "PUT" "/api/users/me" $updateProfile -Headers @{ Authorization = "Bearer $token" }

# Get/Generate API key
Test-Endpoint "POST" "/api/users/me/api-key" @{} -Headers @{ Authorization = "Bearer $token" }

# Get wallet balance
Test-Endpoint "GET" "/api/users/me/wallet" -Headers @{ Authorization = "Bearer $token" }

# Get transaction history
Test-Endpoint "GET" "/api/users/me/transactions" -Headers @{ Authorization = "Bearer $token" }

# Get user's servers
Test-Endpoint "GET" "/api/users/me/servers" -Headers @{ Authorization = "Bearer $token" }

# ===== ADMIN ENDPOINTS (2/25) =====
Write-Host "`n🔵 ADMIN ENDPOINTS (2)" -ForegroundColor Blue

# Get user by ID (requires ADMIN)
Test-Endpoint "GET" "/api/users/550e8400-e29b-41d4-a716-446655440000" -Headers @{ Authorization = "Bearer $token" }

# Update user status (requires ADMIN)
$updateStatus = @{
    status = "ACTIVE"
}
Test-Endpoint "PATCH" "/api/users/550e8400-e29b-41d4-a716-446655440000/status" $updateStatus -Headers @{ Authorization = "Bearer $token" }

# ===== SUMMARY =====
Write-Host "`n" -ForegroundColor Cyan
Write-Host "📊 TEST SUMMARY" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$passed = ($results | Where-Object { $_.Status -eq "✅" }).Count
$failed = ($results | Where-Object { $_.Status -eq "❌" }).Count
$warnings = ($results | Where-Object { $_.Status -eq "⚠️" }).Count

Write-Host "✅ Passed:   $passed" -ForegroundColor Green
Write-Host "❌ Failed:   $failed" -ForegroundColor Red
Write-Host "⚠️ Warnings: $warnings" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Total: $($results.Count) tests`n" -ForegroundColor Cyan

# Export results
$results | Export-Csv -Path "test-results-$(Get-Date -Format 'yyyyMMdd-HHmmss').csv" -NoTypeInformation
Write-Host "📝 Results saved to test-results-*.csv`n" -ForegroundColor Gray
