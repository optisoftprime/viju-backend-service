# Development Credentials Guide

## Overview
This guide provides generic credentials for testing authentication endpoints in the development environment. These credentials should **NEVER** be used in production.

## Setup

### 1. Install Dependencies
All required dependencies for auth are now installed:
- `bcryptjs` - Password hashing
- `passport` & `passport-jwt` - JWT authentication
- `@nestjs/jwt` - NestJS JWT integration

### 2. Seed the Database
Populate the database with test users:

```bash
npm run db:push        # Apply schema changes
npm run db:seed        # Populate with test data
```

Or use Prisma's built-in seed command:
```bash
npx prisma db seed
```

## Generic Dev Credentials

### Customer Accounts
All customer accounts use the same password for simplicity in dev:

| Phone | Name | Password | Status |
|-------|------|----------|--------|
| `254712345678` | John Doe | `Customer@123` | ACTIVE |
| `254787654321` | Jane Smith | `Customer@123` | ACTIVE |

### Staff Accounts
All staff accounts use the same password for simplicity in dev:

| Email | Name | Role | Password | Status |
|-------|------|------|----------|--------|
| `admin@viju.local` | Admin User | ADMIN | `Staff@123` | Active |
| `officer@viju.local` | Sales Officer | OFFICER | `Staff@123` | Active |

## Authentication Endpoints

### 1. Customer Login
**Endpoint:** `POST /auth/customer/login`

**Request:**
```json
{
  "phone": "254712345678",
  "password": "Customer@123"
}
```

**Success Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid-here",
    "name": "John Doe",
    "role": "CUSTOMER"
  }
}
```

### 2. Staff Login
**Endpoint:** `POST /auth/staff/login`

**Request:**
```json
{
  "email": "admin@viju.local",
  "password": "Staff@123"
}
```

**Success Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid-here",
    "name": "Admin User",
    "role": "ADMIN"
  }
}
```

### 3. Customer OTP Request (Optional)
**Endpoint:** `POST /auth/customer/request-otp`

**Request:**
```json
{
  "phone": "254712345678"
}
```

**Success Response (200):**
```json
{
  "message": "OTP sent successfully"
}
```

**Console Output (for dev):**
```
[SMS MOCK] Sent code 123456 to 254712345678
```

### 4. Customer OTP Verification
**Endpoint:** `POST /auth/customer/verify-otp`

**Request:**
```json
{
  "phone": "254712345678",
  "code": "123456",
  "password": "NewPassword@123"
}
```

**Success Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid-here",
    "name": "John Doe",
    "role": "CUSTOMER"
  }
}
```

## Using JWT Tokens

After login, include the `access_token` in the Authorization header:

```bash
curl -H "Authorization: Bearer <access_token>" http://localhost:3000/protected-endpoint
```

Or in Swagger UI:
1. Click the "Authorize" button
2. Enter: `Bearer <access_token>`
3. Click "Authorize"

## Resetting Data

To reset the database and re-seed:

```bash
# Using Prisma
npx prisma migrate reset   # Recreates schema + runs seed

# Or manually
npm run db:push            # Apply schema
npm run db:seed            # Re-seed with test data
```

## Common Error Solutions

### 500 Error on Login
**Problem:** Database is empty or seed wasn't run
**Solution:** Run `npm run db:seed`

### Invalid JWT
**Problem:** Token expired or secret mismatch
**Solution:** Check `JWT_SECRET` in `.env` file matches auth module config

### "Incorrect credentials"
**Problem:** Wrong phone/email or password
**Solution:** Check credentials match the table above; verify case-sensitivity

## Production Notes
⚠️ **IMPORTANT:** These credentials are only for development:
- Change `JWT_SECRET` in production
- Use strong, unique passwords
- Never commit real credentials to version control
- Implement proper user management for production
