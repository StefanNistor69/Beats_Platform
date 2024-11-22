const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// Middleware to authenticate JWT
const authenticateJWT = (req, res, next) => {
  // Define public paths explicitly
  const publicPaths = ['/signup', '/login'];

  // Skip JWT authentication for public paths
  if (req.baseUrl === '/user' && publicPaths.includes(req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1]; // Remove 'Bearer' from 'Bearer <token>'

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.sendStatus(403); // Forbidden
      }

      req.user = user; // Attach the user info to the request object
      next(); // Proceed to the next middleware or route handler
    });
  } else {
    res.sendStatus(401); // Unauthorized
  }
};

module.exports = authenticateJWT;
