# Authentication Setup & Troubleshooting

## ✅ What Was Fixed

### 1. **Missing Dependencies** ❌ → ✅
The auth module was referencing packages that weren't installed:
- ✅ Added `bcryptjs` - For password hashing
- ✅ Added `passport` & `passport-jwt` - For JWT authentication
- ✅ Added `@nestjs/jwt` - NestJS JWT integration  
- ✅ Added `@nestjs/passport` - NestJS Passport bridge

**Install command already run:**
```bash
npm install bcryptjs passport passport-jwt @nestjs/jwt @nestjs/passport --save
```

### 2. **No Test/Dev Data** ❌ → ✅
Database was empty, causing login attempts to return 404/500 errors.

**Solution:** Created a seed script (`prisma/seed.ts`) that populates the database with generic credentials.

### 3. **Type Safety Issues in JWT Strategy** ❌ → ✅
The JWT validation strategy had TypeScript errors that would cause runtime issues:
- ❌ Accessing properties on `null` type
- ❌ Property checking for non-existent properties

**Fixed:** Properly typed the validation logic and separated customer/staff checks.

---

## 🚀 Quick Start

### Step 1: Apply Database Schema
```bash
npm run db:push
```

### Step 2: Seed Database with Test Data
```bash
npm run db:seed
```

### Step 3: Build & Start Dev Server
```bash
npm run build           # Verify no build errors
npm run start:dev      # Start development server
```

### Step 4: Access API
- **Swagger UI:** http://localhost:3000/api
- **Base URL:** http://localhost:3000

---

## 🔐 Generic Dev Credentials

### Customer Login
- **Phone:** `254712345678` or `254787654321`
- **Password:** `Customer@123`

### Staff Login
- **Email:** `admin@viju.local` or `officer@viju.local`
- **Password:** `Staff@123`

See `DEV_CREDENTIALS.md` for complete endpoint documentation and examples.

---

## 📋 Endpoint Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/customer/login` | POST | Login customer via phone+password |
| `/auth/staff/login` | POST | Login staff (admin/officer) via email+password |
| `/auth/customer/request-otp` | POST | Request SMS OTP (mocked in dev) |
| `/auth/customer/verify-otp` | POST | Verify OTP and set password |

---

## 🧪 Testing

### Run E2E Tests
```bash
npm run test:e2e
```

This will test all auth endpoints with the seeded credentials.

### Manual Testing with cURL

**Customer Login:**
```bash
curl -X POST http://localhost:3000/auth/customer/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "254712345678",
    "password": "Customer@123"
  }'
```

**Staff Login:**
```bash
curl -X POST http://localhost:3000/auth/staff/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@viju.local",
    "password": "Staff@123"
  }'
```

### Using Token in Requests
After login, include the `access_token` in the Authorization header:
```bash
curl -H "Authorization: Bearer <your_access_token>" \
  http://localhost:3000/protected-endpoint
```

---

## 🔧 Common Issues & Solutions

### Issue: 500 Error on Login
**Cause:** Database not seeded
```bash
npm run db:seed
```

### Issue: "Cannot find module '@nestjs/passport'"
**Cause:** Dependencies not installed
```bash
npm install
```

### Issue: "Invalid OTP Code" or "Invalid credentials"
**Cause:** Using wrong credentials
- Check `DEV_CREDENTIALS.md` for correct phone/email/password
- Note: Phone numbers are case-sensitive and must start with `254`

### Issue: Token Expired
**Cause:** Default token expiration is 7 days (can be changed in `auth.module.ts`)
```typescript
signOptions: { expiresIn: '7d' }
```

### Issue: Build Fails with TypeScript Errors
**Cause:** Missing types or type mismatches
```bash
npm run build        # Check for specific errors
npm install          # Ensure all dependencies installed
```

---

## 📝 Environment Variables

Create a `.env` file from `.env.example`:
```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/viju?schema=public
JWT_SECRET=your-super-secret-key-change-in-production
JWT_EXPIRATION=1d
```

**Important:** Change `JWT_SECRET` to a strong random value before deploying to production.

---

## 🗄️ Database Schema

### Customer Table
- `id` (UUID, Primary Key)
- `phone` (String, Unique) - Used for login
- `password` (String, hashed with bcrypt)
- `name` (String)
- `erpId` (String, Unique)
- `accountStatus` (ACTIVE | ON_HOLD)
- `assignedOfficerId` (Foreign Key to Staff)

### Staff Table
- `id` (UUID, Primary Key)
- `email` (String, Unique) - Used for login
- `password` (String, hashed with bcrypt)
- `name` (String)
- `role` (ADMIN | OFFICER)
- `isActive` (Boolean)

### OtpVerification Table
- `id` (UUID, Primary Key)
- `phone` (String)
- `code` (String) - 6-digit OTP
- `expiresAt` (DateTime) - 10 minutes from request
- `attempts` (Int) - Failed attempts counter
- `lockedUntil` (DateTime) - Account lock timestamp after 3 failed attempts

---

## 🚢 Production Checklist

- [ ] Change `JWT_SECRET` to a strong random value
- [ ] Use strong passwords for all staff accounts
- [ ] Implement real SMS provider (current is mocked)
- [ ] Add rate limiting to prevent brute force attacks
- [ ] Enable HTTPS
- [ ] Implement proper user management UI
- [ ] Add comprehensive logging
- [ ] Set up proper error handling
- [ ] Remove or secure development endpoints
- [ ] Review and update CORS settings

---

## 📚 Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Passport.js](http://www.passportjs.org/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [bcryptjs Documentation](https://www.npmjs.com/package/bcryptjs)

---

**Created:** 2024  
**Last Updated:** 2024
