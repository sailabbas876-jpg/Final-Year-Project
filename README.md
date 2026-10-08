# AI-Based Car Rental Service

FYP implementation based on the supplied SRS and SDD.

## Architecture
- Frontend: React + Vite + Tailwind CSS
- Backend: Node.js + Express.js + JWT
- Database: MySQL
- AI Microservice: Python + FastAPI + scikit-learn
- REST API between frontend/backend/AI service
- Docker Compose deployment

## Features
- Customer registration/login
- Vehicle browsing, filtering and details
- Booking creation, history and cancellation
- AI vehicle recommendations
- Demand-based dynamic pricing bounded to ±50% of base price
- Fraud/anomaly risk scoring
- Admin dashboard
- Vehicle management
- User/booking monitoring
- Reports/analytics
- Payment abstraction
- Notifications
- Swagger/OpenAPI endpoint

## Run
1. Copy `.env.example` to `.env`.
2. Run `docker compose up --build`.
3. Frontend: http://localhost:5173
4. Backend: http://localhost:5000
5. API docs: http://localhost:5000/api/docs
6. AI service: http://localhost:8000/docs

For local development without Docker:
- `cd backend && npm install && npm run dev`
- `cd frontend && npm install && npm run dev`
- `cd ai-service && pip install -r requirements.txt && uvicorn main:app --reload --port 8000`
