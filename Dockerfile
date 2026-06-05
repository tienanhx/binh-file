# Stage 1: Build frontend assets using Node.js
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY pdfsnake-app/package*.json ./
RUN npm install
COPY pdfsnake-app/ ./
RUN npm run build

# Stage 2: Run the Laravel backend with PHP
FROM php:8.3-fpm-alpine
WORKDIR /var/www/html

# Install system dependencies and PHP extensions
RUN apk add --no-cache \
    git \
    curl \
    libpng-dev \
    libxml2-dev \
    zip \
    unzip \
    sqlite-dev \
    oniguruma-dev

RUN docker-php-ext-install pdo pdo_sqlite bcmath gd

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Copy project files
COPY pdfsnake-app/ .

# Copy Vite-compiled frontend assets from Stage 1
COPY --from=frontend-builder /app/public/build ./public/build

# Install Laravel dependencies
RUN composer install --no-interaction --optimize-autoloader --no-dev

# Configure storage & bootstrap cache permissions for PHP
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

# Expose port 8000
EXPOSE 8000

# Start Laravel built-in server
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
