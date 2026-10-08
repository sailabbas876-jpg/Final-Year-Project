from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict, Any
import math
from sklearn.ensemble import IsolationForest

app=FastAPI(title="AI Car Rental Microservice",version="1.0.0")

class RecommendationInput(BaseModel):
    history: List[Dict[str,Any]]=[]
    cars: List[Dict[str,Any]]=[]

class PricingInput(BaseModel):
    base_price: float
    availability: float=1
    demand: float=1
    days: int=1

class FraudInput(BaseModel):
    days: int
    total_price: float
    booking_count: int=1

@app.get("/health")
def health(): return {"status":"ok","service":"ai"}

@app.post("/recommend")
def recommend(data:RecommendationInput):
    if not data.cars: return {"recommendations":[]}
    preferred={}
    for h in data.history:
        c=h.get("category")
        if c: preferred[c]=preferred.get(c,0)+1
    ranked=[]
    for car in data.cars:
        score=preferred.get(car.get("category"),0)*10
        score += max(0,100-float(car.get("base_price",100)))
        ranked.append((score,car))
    ranked.sort(key=lambda x:x[0],reverse=True)
    return {"recommendations":[c for _,c in ranked[:6]],"strategy":"behavioral-preference + popularity/cold-start fallback"}

@app.post("/pricing")
def pricing(data:PricingInput):
    # Demand/availability adjustment, strictly bounded to 50% above/below base price.
    pressure=(data.demand/max(data.availability,0.1))
    multiplier=1 + min(0.50,max(-0.50,0.10*(pressure-1)))
    return {"price":round(data.base_price*multiplier,2),"multiplier":round(multiplier,3),"bounded":True}

@app.post("/fraud")
def fraud(data:FraudInput):
    features=[[data.days,data.total_price,data.booking_count]]
    model=IsolationForest(contamination=0.1,random_state=42)
    # Tiny synthetic reference population to provide an anomaly score.
    baseline=[[1,60,1],[2,120,1],[3,180,1],[2,130,2],[4,240,1],[1,80,1],[5,300,1],[2,110,1],[3,170,1],[1,50,1]]
    model.fit(baseline)
    pred=model.predict(features)[0]
    raw=float(-model.score_samples(features)[0])
    risk=70 if pred==-1 else 15
    risk=min(100,max(risk,round(raw*30,2)))
    reason="Anomalous booking pattern detected" if pred==-1 else "No significant anomaly detected"
    return {"risk_score":risk,"reason":reason}
