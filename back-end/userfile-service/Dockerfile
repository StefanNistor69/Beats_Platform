# Use the official Node.js image (version 16 or higher)
FROM node:16

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port for the UserFile Service
EXPOSE 5001

# Run the application
CMD ["node", "app.js"]
