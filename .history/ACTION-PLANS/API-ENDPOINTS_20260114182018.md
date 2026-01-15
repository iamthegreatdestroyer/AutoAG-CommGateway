# 📡 Phase 3 API Endpoints Reference

**AutoAG-CommGateway REST API** - Complete endpoint documentation

**Base URL:** `http://localhost:18500`

---

## 🔐 Authentication

All authenticated endpoints require an `Authorization` header:
```
Authorization: Bearer <access_token>
```

**Token Lifetime:**
- Access Token: 1 hour
- Refresh Token: 7 days

---

## 🌟 Authentication Endpoints

### Register New User

```http
POST /api/auth/register
```

**Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "username": "johndoe",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response (201):**
```json
{
  "message": "User registered successfully",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "johndoe",
    "firstName": "John",
    "lastName": "Doe",
    "role": "USER",
    "createdAt": "2026-01-14T..."
  },
  "tokens": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

---

### Login

```http
POST /api/auth/login
```

**Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response (200):**
```json
{
  "message": "Login successful",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "johndoe",
    "firstName": "John",
    "lastName": "Doe",
    "role": "USER",
    "walletBalance": "0.00"
  },
  "tokens": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

---

### Refresh Token

```http
POST /api/auth/refresh
```

**Body:**
```json
{
  "refreshToken": "eyJ..."
}
```

**Response (200):**
```json
{
  "message": "Token refreshed successfully",
  "tokens": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

---

### Logout

```http
POST /api/auth/logout
```

**Response (200):**
```json
{
  "message": "Logout successful"
}
```

---

## 🖥️ MCP Server Endpoints

### List/Search Servers

```http
GET /api/servers?search=weather&category=data&status=ACTIVE&page=1&limit=20&sortBy=rating&sortOrder=desc
```

**Auth:** Optional (public servers visible without auth)

**Query Parameters:**
- `search` - Full-text search (name, displayName, description)
- `category` - Filter by category (weather, finance, etc.)
- `status` - ACTIVE | PENDING | INACTIVE
- `visibility` - PUBLIC | PRIVATE (admin only)
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)
- `sortBy` - rating | totalCalls | createdAt
- `sortOrder` - asc | desc

**Response (200):**
```json
{
  "servers": [
    {
      "id": "uuid",
      "name": "weather-api",
      "displayName": "Weather API",
      "description": "Real-time weather data",
      "baseUrl": "https://weather.example.com",
      "category": ["weather", "data"],
      "status": "ACTIVE",
      "visibility": "PUBLIC",
      "pricingModel": "PAY_PER_CALL",
      "pricePerCall": "0.01",
      "rating": "4.5",
      "totalCalls": "12500",
      "owner": {
        "id": "uuid",
        "username": "weatherdev",
        "firstName": "Weather",
        "lastName": "Developer"
      },
      "_count": {
        "tools": 4,
        "reviews": 23
      },
      "createdAt": "2026-01-01T..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  }
}
```

---

### Get Top Servers

```http
GET /api/servers/top?limit=10
```

**Auth:** None

**Response (200):**
```json
{
  "servers": [...]
}
```

---

### Get Server Details

```http
GET /api/servers/:id
```

**Auth:** Optional (required for private servers)

**Response (200):**
```json
{
  "server": {
    "id": "uuid",
    "name": "weather-api",
    "displayName": "Weather API",
    "description": "Real-time weather data with forecasts",
    "baseUrl": "https://weather.example.com",
    "category": ["weather", "data"],
    "status": "ACTIVE",
    "visibility": "PUBLIC",
    "pricingModel": "PAY_PER_CALL",
    "pricePerCall": "0.01",
    "rating": "4.5",
    "totalCalls": "12500",
    "totalRevenue": "125.00",
    "healthStatus": "HEALTHY",
    "ownerId": "uuid",
    "createdAt": "2026-01-01T...",
    "updatedAt": "2026-01-14T..."
  }
}
```

---

### Create Server

```http
POST /api/servers
```

**Auth:** Required (DEVELOPER, ADMIN, SUPER_ADMIN)

**Body:**
```json
{
  "name": "my-api",
  "displayName": "My API Service",
  "description": "Description of my API",
  "baseUrl": "https://api.example.com",
  "category": ["data", "utility"],
  "visibility": "PUBLIC",
  "pricingModel": "PAY_PER_CALL",
  "pricePerCall": 0.01
}
```

**Response (201):**
```json
{
  "message": "Server created successfully",
  "server": {...}
}
```

---

### Update Server

```http
PUT /api/servers/:id
```

**Auth:** Required (Owner or Admin)

**Body:** (all fields optional)
```json
{
  "displayName": "Updated Name",
  "description": "Updated description",
  "baseUrl": "https://newurl.example.com",
  "category": ["data"],
  "visibility": "PRIVATE",
  "pricePerCall": 0.02
}
```

**Response (200):**
```json
{
  "message": "Server updated successfully",
  "server": {...}
}
```

---

### Delete Server

```http
DELETE /api/servers/:id
```

**Auth:** Required (Owner or Admin)

**Response (200):**
```json
{
  "message": "Server deleted successfully"
}
```

---

### Publish Server

```http
POST /api/servers/:id/publish
```

**Auth:** Required (Owner or Admin)

**Description:** Changes server status from PENDING to ACTIVE

**Response (200):**
```json
{
  "message": "Server published successfully",
  "server": {...}
}
```

---

### Get User's Servers

```http
GET /api/servers/owner/:userId
```

**Auth:** Required (Owner or Admin)

**Response (200):**
```json
{
  "servers": [...]
}
```

---

## 🛠️ Tool Endpoints

### Get Tools for Server

```http
GET /api/tools/server/:serverId
```

**Auth:** Optional

**Response (200):**
```json
{
  "tools": [
    {
      "id": "uuid",
      "serverId": "uuid",
      "name": "getCurrentWeather",
      "displayName": "Get Current Weather",
      "description": "Get current weather for a location",
      "inputSchema": {...},
      "outputSchema": {...},
      "status": "ACTIVE",
      "pricePerCall": "0.01",
      "totalCalls": "5000",
      "avgDurationMs": "120",
      "successRate": "0.98",
      "createdAt": "2026-01-01T..."
    }
  ]
}
```

---

### Get Tool Details

```http
GET /api/tools/:id
```

**Auth:** Optional

**Response (200):**
```json
{
  "tool": {...}
}
```

---

### Create Tool

```http
POST /api/tools
```

**Auth:** Required (Server owner or Admin)

**Body:**
```json
{
  "serverId": "uuid",
  "name": "myTool",
  "displayName": "My Tool",
  "description": "Tool description",
  "inputSchema": {
    "type": "object",
    "properties": {
      "param1": { "type": "string" }
    },
    "required": ["param1"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "result": { "type": "string" }
    }
  },
  "pricePerCall": 0.01
}
```

**Response (201):**
```json
{
  "message": "Tool created successfully",
  "tool": {...}
}
```

---

### Update Tool

```http
PUT /api/tools/:id
```

**Auth:** Required (Server owner or Admin)

**Body:** (all fields optional)
```json
{
  "displayName": "Updated Tool Name",
  "description": "Updated description",
  "pricePerCall": 0.02
}
```

**Response (200):**
```json
{
  "message": "Tool updated successfully",
  "tool": {...}
}
```

---

### Delete Tool

```http
DELETE /api/tools/:id
```

**Auth:** Required (Server owner or Admin)

**Response (200):**
```json
{
  "message": "Tool deleted successfully"
}
```

---

### Invoke Tool

```http
POST /api/tools/:id/invoke
```

**Auth:** Required

**Rate Limit:** 60 requests per minute per user

**Body:**
```json
{
  "inputData": {
    "param1": "value1"
  }
}
```

**Response (200):**
```json
{
  "message": "Tool invoked successfully",
  "result": {
    "toolId": "uuid",
    "inputData": {...},
    "outputData": {
      "status": "success",
      "data": {...}
    },
    "durationMs": 125,
    "timestamp": "2026-01-14T..."
  }
}
```

---

### Get Popular Tools

```http
GET /api/tools/popular/list?limit=10
```

**Auth:** None

**Response (200):**
```json
{
  "tools": [...]
}
```

---

## 👤 User Endpoints

### Get Current User Profile

```http
GET /api/users/me
```

**Auth:** Required

**Response (200):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "johndoe",
    "firstName": "John",
    "lastName": "Doe",
    "role": "USER",
    "status": "ACTIVE",
    "walletBalance": "25.50",
    "walletAddress": null,
    "emailVerified": true,
    "createdAt": "2026-01-01T...",
    "lastLoginAt": "2026-01-14T..."
  }
}
```

---

### Update Profile

```http
PUT /api/users/me
```

**Auth:** Required

**Body:** (all fields optional)
```json
{
  "firstName": "Johnny",
  "lastName": "Doe",
  "walletAddress": "0x..."
}
```

**Response (200):**
```json
{
  "message": "Profile updated successfully",
  "user": {...}
}
```

---

### Generate API Key

```http
POST /api/users/me/api-key
```

**Auth:** Required (DEVELOPER, ADMIN, SUPER_ADMIN)

**Response (201):**
```json
{
  "message": "API key generated successfully",
  "apiKey": "sk_live_abc123..."
}
```

---

### Get Wallet Balance

```http
GET /api/users/me/wallet
```

**Auth:** Required

**Response (200):**
```json
{
  "balance": "25.50",
  "walletAddress": null
}
```

---

### Get Transaction History

```http
GET /api/users/me/transactions?page=1&limit=20
```

**Auth:** Required

**Response (200):**
```json
{
  "transactions": [
    {
      "id": "uuid",
      "type": "PAYMENT",
      "status": "COMPLETED",
      "amount": "0.01",
      "platformFee": "0.0015",
      "serverId": "uuid",
      "createdAt": "2026-01-14T..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  }
}
```

---

### Get User's Servers

```http
GET /api/users/me/servers
```

**Auth:** Required

**Response (200):**
```json
{
  "servers": [...]
}
```

---

## 👮 Admin Endpoints

### Get User by ID

```http
GET /api/users/:id
```

**Auth:** Required (ADMIN, SUPER_ADMIN)

**Response (200):**
```json
{
  "user": {...}
}
```

---

### Update User Status

```http
PATCH /api/users/:id/status
```

**Auth:** Required (ADMIN, SUPER_ADMIN)

**Body:**
```json
{
  "status": "SUSPENDED"
}
```

**Valid Status Values:**
- `ACTIVE`
- `SUSPENDED`
- `BANNED`

**Response (200):**
```json
{
  "message": "User status updated successfully",
  "user": {...}
}
```

---

## 🚦 Error Responses

All errors follow this format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message",
  "details": [...] // Optional, for validation errors
}
```

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `TOKEN_EXPIRED` | 401 | Access token has expired |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `SERVER_ERROR` | 500 | Internal server error |

---

## 📊 Rate Limits

| Endpoint Type | Window | Max Requests |
|---------------|--------|--------------|
| General API | 15 minutes | 100 |
| Authentication | 15 minutes | 5 (skip successful) |
| Tool Invocation | 1 minute | 60 per user |
| Server Creation | 1 hour | 10 per user |

---

## 🔑 Role-Based Access

| Role | Capabilities |
|------|--------------|
| `USER` | View public servers/tools, invoke tools |
| `DEVELOPER` | + Create/manage servers, generate API keys |
| `ADMIN` | + Manage any server, view any user |
| `SUPER_ADMIN` | + Full system access |

---

**API Version:** 1.0  
**Last Updated:** January 14, 2026  
**Base URL:** `http://localhost:18500`

For more information, see [PHASE-3-COMPLETE.md](PHASE-3-COMPLETE.md).
