# Official Microsoft Playwright Image matching installed Playwright version
FROM mcr.microsoft.com/playwright:v1.65.0-noble

# Set working directory
WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HEADLESS=true

# Copy package descriptors
COPY package*.json ./

# Install dependencies and ensure matching Chromium binary is present
RUN npm ci --omit=dev && npx playwright install chromium

# Copy application source code
COPY . .

# Ensure session and exports directories exist
RUN mkdir -p /app/whatsapp-session /app/exports

# Define persistent volumes for session cookies and generated spreadsheets
VOLUME ["/app/whatsapp-session", "/app/exports"]

# Expose web application port
EXPOSE 3000

# Start server
CMD ["node", "src/server.js"]
