# Official Microsoft Playwright Image with Node.js & Chromium pre-installed
FROM mcr.microsoft.com/playwright:v1.65.0-noble

# Set working directory
WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HEADLESS=true

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Ensure session and exports directories exist
RUN mkdir -p /app/whatsapp-session /app/exports

# Define persistent volumes for session cookies and generated spreadsheets
VOLUME ["/app/whatsapp-session", "/app/exports"]

# Expose web application port
EXPOSE 3000

# Start server with memory optimization for 512MB cloud containers
CMD ["node", "--max-old-space-size=256", "src/server.js"]
