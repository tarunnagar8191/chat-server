#!/bin/bash

echo "🧪 Testing CareH Chat Microservice..."
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Base URL
BASE_URL="http://localhost:3001"

# Function to test endpoint
test_endpoint() {
    local endpoint=$1
    local method=${2:-GET}
    local description=$3
    local expected_status=${4:-200}
    
    echo -e "${BLUE}Testing:${NC} $description"
    echo -e "${YELLOW}$method${NC} $BASE_URL$endpoint"
    
    response=$(curl -s -w "\n%{http_code}" -X $method "$BASE_URL$endpoint")
    body=$(echo "$response" | head -n -1)
    status=$(echo "$response" | tail -n 1)
    
    if [ "$status" -eq "$expected_status" ]; then
        echo -e "${GREEN}✅ PASS${NC} (Status: $status)"
        if [ -n "$body" ]; then
            echo "$body" | jq . 2>/dev/null || echo "$body"
        fi
    else
        echo -e "${RED}❌ FAIL${NC} (Status: $status, Expected: $expected_status)"
        echo "$body"
    fi
    echo "----------------------------------------"
}

# Check if server is running
echo -e "${BLUE}Checking if server is running...${NC}"
if curl -s "$BASE_URL/health" > /dev/null; then
    echo -e "${GREEN}✅ Server is running${NC}"
else
    echo -e "${RED}❌ Server is not running. Please start it first with: node server.js${NC}"
    exit 1
fi

echo ""

# Test endpoints
test_endpoint "/health" "GET" "Health Check Endpoint"
test_endpoint "/api/info" "GET" "Service Info Endpoint"

# Test protected endpoints (should fail without auth)
test_endpoint "/api/chat/users" "GET" "Get Users (No Auth)" 401
test_endpoint "/api/chat/conversations" "GET" "Get Conversations (No Auth)" 401
test_endpoint "/api/calls/history" "GET" "Get Call History (No Auth)" 401

# Test 404
test_endpoint "/nonexistent" "GET" "Non-existent Endpoint" 404

echo ""
echo -e "${GREEN}🎉 Basic API tests completed!${NC}"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo "1. Create JWT tokens using your Django backend"
echo "2. Test authenticated endpoints with proper tokens"
echo "3. Test WebSocket connections with Socket.io client"
echo "4. Integrate with your React Native app"
echo ""
echo -e "${BLUE}📚 Documentation:${NC}"
echo "- API Documentation: $BASE_URL/api/info"
echo "- Health Status: $BASE_URL/health"
echo "- Integration Guide: ./INTEGRATION.md"
echo "- Examples: ./examples/"
