# Auth Endpoints - Quick Reference

## 🔑 Login Endpoints

### Customer Login
```bash
POST /auth/customer/login
Content-Type: application/json

{
  "phone": "254712345678",
  "password": "Customer@123"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "John Doe",
    "role": "CUSTOMER"
  }
}
```

---

### Staff Login
```bash
POST /auth/staff/login
Content-Type: application/json

{
  "email": "admin@viju.local",
  "password": "Staff@123"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "Admin User",
    "role": "ADMIN"
  }
}
```

---

## 📱 OTP Endpoints

### Request OTP
```bash
POST /auth/customer/request-otp
Content-Type: application/json

{
  "phone": "254712345678"
}
```

**Response (200):**
```json
{
  "message": "OTP sent successfully"
}
```

**Console Output (dev only):**
```
[SMS MOCK] Sent code 123456 to 254712345678
```

---

### Verify OTP & Set Password
```bash
POST /auth/customer/verify-otp
Content-Type: application/json

{
  "phone": "254712345678",
  "code": "123456",
  "password": "NewPassword@123"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "John Doe",
    "role": "CUSTOMER"
  }
}
```

---

## 🔐 Test Credentials

| Type | ID | Password |
|------|-----|----------|
| Customer | `254712345678` | `Customer@123` |
| Customer | `254787654321` | `Customer@123` |
| Admin | `admin@viju.local` | `Staff@123` |
| Officer | `officer@viju.local` | `Staff@123` |

---

## 🛠️ Setup Commands

```bash
# Install dependencies (already done)
npm install

# Apply database schema
npm run db:push

# Seed database with test data
npm run db:seed

# Build project
npm run build

# Start development server
npm run start:dev

# Run E2E tests
npm run test:e2e
```

---

## ✋ Using JWT Token

**In Header:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**With cURL:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/protected-endpoint
```

**With Swagger UI:**
1. Click "Authorize" button
2. Enter: `Bearer YOUR_TOKEN`
3. Click "Authorize"

---

## ❌ Error Responses

### 401 Unauthorized
```json
{
  "statusCode": 401,
  "message": "Incorrect password. Please try again."
}
```

### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "This number is not registered with Viju. Please contact your account officer."
}
```

### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "No OTP found for this number"
}
```

---

## 📖 Documentation Files

- `DEV_CREDENTIALS.md` - Complete credentials guide with examples
- `AUTH_SETUP.md` - Detailed setup and troubleshooting guide
- `test/auth.e2e-spec.ts` - E2E tests for all endpoints

---

**Version:** 1.0  
**Updated:** 2024
