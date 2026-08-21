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

**Password for every staff account below: `Staff@123`**

These four roles are internally managed — an ADMIN creates them, the ERP does
not. They sign in with **email + password**, either at
`POST /auth/staff/login` (`{ email, password }`) or at
`POST /auth/staff/web-login` (`{ username: <email>, code: <password> }`, which
is what the web portal posts).

Seed them with:

```bash
npm run db:seed:staff     # additive + idempotent; only touches the Staff table
```

Two accounts per role per region (32 total). ADMIN is organisation-wide and
never carries a region.

#### ADMIN (2)

| Email | Name |
|---|---|
| `admin1@viju.local` | Grace Adeyemi |
| `admin2@viju.local` | Daniel Eshiet |

#### REGIONAL_ADMIN (2 per region)

| Region | Email | Name |
|---|---|---|
| LAGOS | `regional.lagos1@viju.local` | Ngozi Okafor |
| LAGOS | `regional.lagos2@viju.local` | Tunde Bakare |
| EASTERN | `regional.eastern1@viju.local` | Chidera Anyanwu |
| EASTERN | `regional.eastern2@viju.local` | Emeka Nwosu |
| SOUTH_SOUTH | `regional.southsouth1@viju.local` | Preye Amaso |
| SOUTH_SOUTH | `regional.southsouth2@viju.local` | Itoro Effiong |
| WESTERN | `regional.western1@viju.local` | Yewande Ogunbiyi |
| WESTERN | `regional.western2@viju.local` | Segun Alabi |
| NORTH | `regional.north1@viju.local` | Musa Aliyu |
| NORTH | `regional.north2@viju.local` | Hauwa Danjuma |

#### OFFICER — account officer (2 per region)

| Region | Email | Name |
|---|---|---|
| LAGOS | `officer.lagos1@viju.local` | Funmi Adelaja |
| LAGOS | `officer.lagos2@viju.local` | Ifeoma Balogun |
| EASTERN | `officer.eastern1@viju.local` | Chukwuma Eze |
| EASTERN | `officer.eastern2@viju.local` | Adaeze Obiora |
| SOUTH_SOUTH | `officer.southsouth1@viju.local` | Ebiere Tamuno |
| SOUTH_SOUTH | `officer.southsouth2@viju.local` | Oghenero Ejiro |
| WESTERN | `officer.western1@viju.local` | Bolanle Adeyemi |
| WESTERN | `officer.western2@viju.local` | Kayode Sanusi |
| NORTH | `officer.north1@viju.local` | Aisha Bello |
| NORTH | `officer.north2@viju.local` | Sanusi Garba |

#### LOADING_OFFICER (2 per region)

| Region | Email | Name |
|---|---|---|
| LAGOS | `loader.lagos1@viju.local` | Ifeanyi Okonkwo |
| LAGOS | `loader.lagos2@viju.local` | Basirat Lawal |
| EASTERN | `loader.eastern1@viju.local` | Obinna Udeh |
| EASTERN | `loader.eastern2@viju.local` | Nkiru Chukwu |
| SOUTH_SOUTH | `loader.southsouth1@viju.local` | Tonye Briggs |
| SOUTH_SOUTH | `loader.southsouth2@viju.local` | Mercy Akpan |
| WESTERN | `loader.western1@viju.local` | Bisi Adewale |
| WESTERN | `loader.western2@viju.local` | Femi Oyelaran |
| NORTH | `loader.north1@viju.local` | Zainab Yusuf |
| NORTH | `loader.north2@viju.local` | Ibrahim Tanko |

Phone numbers run `+2349010000001` … `+2349010000032` in the order above, if
you need one for a lookup.

> `npm run db:seed` (the full seed) uses a **different, older roster** —
> `admin@viju.local`, `officer.lagos@viju.local`, etc. — and it **deletes every
> staff row first**. Do not run it against a shared environment; use
> `db:seed:staff` for staff.

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
