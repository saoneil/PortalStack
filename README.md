# PortalStack

A secure, scalable Node.js-based membership management portal featuring robust authentication and session handling. This full-stack web application demonstrates modern security practices and enterprise-grade architecture.

## Technical Overview

Built with a modern tech stack emphasizing security and scalability:

### Backend Architecture
- **Node.js/Express.js** REST API with modular architecture
- **MySQL** database integration with stored procedures for optimal performance
- **Session-based authentication** with MySQL session store
- **Security Features:**
  - BCrypt password hashing
  - Rate limiting for brute force prevention
  - Secure session management
  - HTTP-only cookies
  - Environment variable configuration
  - Helmet.js for enhanced security headers

### Frontend Design
- Clean, responsive UI with modern CSS animations
- Mobile-first approach
- Custom-styled components
- Secure form handling

### Key Features
- Multi-tenant architecture supporting multiple client organizations
- Secure user authentication and session management
- Rate-limited login protection
- Scalable user registration system
- Dynamic data grid integration
- Stateless architecture ready for horizontal scaling

### DevOps & Deployment
- Heroku deployment with production configuration
- Environment-based configuration management
- Production-ready security measures

## Technical Highlights
- Implements industry best practices for session management and authentication
- Uses prepared statements and stored procedures for SQL injection prevention
- Features a modular, maintainable codebase structure
- Incorporates professional error handling and logging
- Demonstrates understanding of full-stack security considerations

## Development Practices
- Clean code principles
- Security-first development approach
- Environment-based configuration
- Proper error handling and logging

## Installation

1. Clone the repository
```bash
git clone <your-repo-url>
cd PortalStack
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables by creating a `.env` file:
```env
DB_HOST=your_host
DB_USER=your_user
DB_PASS=your_password
DB_NAME=your_database
DB_PORT=3306
SESSION_SECRET=your_session_secret
NODE_ENV=development
PORT=3000
```

4. Set up the MySQL database and ensure it's running

5. Start the application
```bash
npm start
```

## Local Development

The application will be available at `http://localhost:3000` by default.

## Deployment

This application is configured for deployment on Heroku. Make sure to:

1. Set up all environment variables in your Heroku dashboard
2. Configure the MySQL add-on in Heroku
3. Deploy using Heroku Git:
```bash
heroku login
heroku git:remote -a your-app-name
git push heroku main
```

## Security Notes

- Ensure proper environment variable configuration in production
- Use strong passwords for database and session secrets
- Keep dependencies updated
- Monitor application logs for suspicious activity

## License

[Your chosen license] 