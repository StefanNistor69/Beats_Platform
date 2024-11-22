from flask import Flask, request, jsonify
import requests
import os
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from pybreaker import CircuitBreaker
from prometheus_flask_exporter import PrometheusMetrics

app = Flask(__name__)

# Set up rate limiting (5 requests per minute)
limiter = Limiter(
    key_func=get_remote_address
)


metrics = PrometheusMetrics(app)
metrics.info("api_gateway_info", "API Gateway metrics", version="1.0.0")



# Circuit breaker configuration
FAIL_MAX = 3
RESET_TIMEOUT = 30

# Service Discovery URL
SERVICE_DISCOVERY_URL = os.getenv('SERVICE_DISCOVERY_URL', 'http://service-discovery:8500')

# List of userfile-service replicas (assuming same port 5001)
USERFILE_REPLICAS = [
    {"host": "userfile-service-1", "port": "5001"},
    {"host": "userfile-service-2", "port": "5001"},
    {"host": "userfile-service-3", "port": "5001"}
]

# Create a circuit breaker for each userfile-service replica
userfile_circuit_breakers = {}
for replica in USERFILE_REPLICAS:
    replica_key = f"{replica['host']}:{replica['port']}"
    userfile_circuit_breakers[replica_key] = CircuitBreaker(fail_max=FAIL_MAX, reset_timeout=RESET_TIMEOUT)

def discover_service(service_name):
    """Discover service address and port from the service discovery."""
    try:
        response = requests.get(f"{SERVICE_DISCOVERY_URL}/services/{service_name}", timeout=5)
        if response.status_code == 200:
            data = response.json()
            return data['address'], data['port']
        else:
            app.logger.error(f"Service {service_name} not found in Service Discovery")
            return None, None
    except Exception as e:
        app.logger.error(f"Error discovering service {service_name}: {str(e)}")
        return None, None

def make_request_with_circuit_breaker(url, method, headers=None, data=None, files=None):
    for replica in USERFILE_REPLICAS:
        service_url = f"http://{replica['host']}:{replica['port']}/{url}"
        circuit_breaker = userfile_circuit_breakers[f"{replica['host']}:{replica['port']}"]

        if circuit_breaker.current_state == "open":
            app.logger.error(f"Skipping replica {service_url} as circuit breaker is open")
            continue

        for attempt in range(3):  # Try 3 times per replica
            try:
                if method == "POST":
                    if files:
                        # Do not set 'Content-Type' header when uploading files
                        response = circuit_breaker.call(
                            requests.post, service_url, headers=headers, data=data, files=files, timeout=10
                        )
                    else:
                        response = circuit_breaker.call(
                            requests.post, service_url, headers=headers, json=data, timeout=10
                        )
                
                # Stop retries on client-side errors
                if response.status_code >= 400 and response.status_code < 500:
                    app.logger.error(f"Client error {response.status_code} for {service_url}")
                    return response.content, response.status_code, response.headers.items()

                if response.status_code in (200, 201):
                    return response.content, response.status_code, response.headers.items()

            except Exception as e:
                app.logger.error(f"Attempt {attempt + 1} failed for {service_url}: {str(e)}")
    return None


def ping_service(service_name):
    """Ping the service and check if it is running."""
    host, port = discover_service(service_name)
    if not host or not port:
        return {"service": service_name, "status": "unavailable"}

    try:
        response = requests.get(f"http://{host}:{port}/status", timeout=5)
        if response.status_code == 200:
            return {"service": service_name, "status": "running"}
        else:
            return {"service": service_name, "status": "error", "code": response.status_code}
    except requests.exceptions.RequestException as e:
        return {"service": service_name, "status": "unavailable", "error": str(e)}

# Status endpoint that pings each service and returns their status
@app.route('/status', methods=['GET'])
@limiter.limit("10 per minute")  # Apply rate limiting to status endpoint
def status():
    services = ['userfile-service', 'notification-service']
    service_statuses = [ping_service(service) for service in services]

    return jsonify({
        "gateway_status": "running",
        "services": service_statuses
    }), 200

# Proxy request to user-file service with rate limiting
@app.route('/user/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
@limiter.limit("5 per minute")  # Apply rate limiting to user-related requests
def proxy_user_file_service(path):
    try:
        headers = {'Content-Type': 'application/json'}
        data = request.json

        # Log the data being sent
        app.logger.info(f"Proxying request to {path}: Data={data}, Headers={headers}")

        # Make request to userfile-service via circuit breaker
        result = make_request_with_circuit_breaker(f"user/{path}", request.method, headers=headers, data=data)

        if result:
            content, status_code, headers_items = result

            # Handle notifications for signup and login
            if path in ['signup', 'login'] and request.method == 'POST' and status_code in (200, 201):
                notification_service_host, notification_service_port = discover_service('notification-service')
                if notification_service_host and notification_service_port:
                    notify_url = f"http://{notification_service_host}:{notification_service_port}/notify-{path}"
                    try:
                        notify_response = requests.post(notify_url, timeout=10)
                        if notify_response.status_code == 200:
                            app.logger.info(f"{path.capitalize()} notification sent successfully")
                        else:
                            app.logger.error(f"Failed to send {path} notification")
                    except Exception as e:
                        app.logger.error(f"Error sending {path} notification: {str(e)}")
                else:
                    app.logger.error("Notification service unavailable")

            return content, status_code, headers_items
        else:
            return jsonify({"error": "All replicas failed. Circuit breakers tripped."}), 503

    except requests.exceptions.Timeout:
        return jsonify({"error": "Request timed out"}), 504

    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 500


# Proxy request to beat upload with rate limiting
@app.route('/beats/upload', methods=['POST'])
@limiter.limit("5 per minute")  # Apply rate limiting to beat upload requests
def proxy_beat_upload():
    try:
        # Discover notification service
        notification_service_host, notification_service_port = discover_service('notification-service')

        if 'beat' in request.files:
            files = {'beat': request.files['beat']}
            data = {
                'title': request.form.get('title'),
                'artist': request.form.get('artist')
            }

            headers = {'Authorization': request.headers.get('Authorization')}

            # Make request to userfile-service via circuit breaker
            result = make_request_with_circuit_breaker("beats/upload", "POST", headers=headers, data=data, files=files)

            if result:
                content, status_code, headers_items = result

                # Handle notification after successful upload
                if status_code == 201 and notification_service_host and notification_service_port:
                    notify_url = f"http://{notification_service_host}:{notification_service_port}/notify-upload"
                    try:
                        notify_response = requests.post(notify_url, timeout=10)
                        if notify_response.status_code == 200:
                            app.logger.info("Beat upload notification sent successfully")
                        else:
                            app.logger.error("Failed to send beat upload notification")
                    except Exception as e:
                        app.logger.error(f"Error sending beat upload notification: {str(e)}")
                else:
                    app.logger.error("Notification service unavailable or upload failed")

                return content, status_code, headers_items
            else:
                return jsonify({"error": "All replicas failed. Circuit breakers tripped."}), 503
        else:
            return jsonify({"error": "No file part in the request"}), 400

    except requests.exceptions.Timeout:
        return jsonify({"error": "Request timed out"}), 504

    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=True)
