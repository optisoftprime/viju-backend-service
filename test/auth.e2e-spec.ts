import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Auth Endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/customer/login', () => {
    it('should login customer with valid credentials', () => {
      return request(app.getHttpServer())
        .post('/auth/customer/login')
        .send({
          phone: '254712345678',
          password: 'Customer@123',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('access_token');
          expect(res.body).toHaveProperty('user');
          expect(res.body.user).toHaveProperty('id');
          expect(res.body.user).toHaveProperty('name');
          expect(res.body.user.role).toBe('CUSTOMER');
        });
    });

    it('should reject invalid password', () => {
      return request(app.getHttpServer())
        .post('/auth/customer/login')
        .send({
          phone: '254712345678',
          password: 'WrongPassword',
        })
        .expect(401);
    });

    it('should reject non-existent customer', () => {
      return request(app.getHttpServer())
        .post('/auth/customer/login')
        .send({
          phone: '254799999999',
          password: 'Customer@123',
        })
        .expect(401);
    });
  });

  describe('POST /auth/staff/login', () => {
    it('should login admin with valid credentials', () => {
      return request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({
          email: 'admin@viju.local',
          password: 'Staff@123',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('access_token');
          expect(res.body).toHaveProperty('user');
          expect(res.body.user.role).toBe('ADMIN');
        });
    });

    it('should login officer with valid credentials', () => {
      return request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({
          email: 'officer@viju.local',
          password: 'Staff@123',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('access_token');
          expect(res.body).toHaveProperty('user');
          expect(res.body.user.role).toBe('OFFICER');
        });
    });

    it('should reject invalid email', () => {
      return request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({
          email: 'invalid@viju.local',
          password: 'Staff@123',
        })
        .expect(401);
    });

    it('should reject invalid password', () => {
      return request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({
          email: 'admin@viju.local',
          password: 'WrongPassword',
        })
        .expect(401);
    });
  });

  describe('POST /auth/customer/request-otp', () => {
    it('should send OTP to valid customer', () => {
      return request(app.getHttpServer())
        .post('/auth/customer/request-otp')
        .send({
          phone: '254712345678',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
        });
    });

    it('should reject non-existent customer', () => {
      return request(app.getHttpServer())
        .post('/auth/customer/request-otp')
        .send({
          phone: '254799999999',
        })
        .expect(404);
    });
  });
});
