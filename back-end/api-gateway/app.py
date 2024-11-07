from flask import Flask, request, jsonify
import requests
import os
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(__name__)

# Set up rate limiting (5 requests per minute)
limiter = Limiter(
    app,
    key_func=get_remote_address,
    default_limits=["5 per minute"]
)

# Service Discovery URL
SERVICE_DISCOVERY_URL = os.getenv('SERVICE_DISCOVERY_URL', 'http://service-discovery:8500')

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
        user_file_service_host, user_file_service_port = discover_service('userfile-service')
        notification_service_host, notification_service_port = discover_service('notification-service')

        if not user_file_service_host or not user_file_service_port:
            return jsonify({"error": "UserFile Service unavailable"}), 503
        
        service_url = f"http://{user_file_service_host}:{user_file_service_port}/user/{path}"
        
        if request.method == 'GET':
            response = requests.get(service_url, timeout=10)
        elif request.method == 'POST':
            response = requests.post(service_url, json=request.json, timeout=10)

            if path == 'signup' and response.status_code == 201:
                notify_url = f"http://{notification_service_host}:{notification_service_port}/notify-signup"
                notify_response = requests.post(notify_url, timeout=10)
                if notify_response.status_code == 200:
                    print("Signup notification sent successfully", flush=True)
                else:
                    print("Failed to send signup notification", flush=True)

            elif path == 'login' and response.status_code == 200:
                notify_url = f"http://{notification_service_host}:{notification_service_port}/notify-login"
                notify_response = requests.post(notify_url, timeout=10)
                if notify_response.status_code == 200:
                    print("Login notification sent successfully", flush=True)
                else:
                    print("Failed to send login notification", flush=True)

        elif request.method == 'PUT':
            response = requests.put(service_url, json=request.json, timeout=10)
        elif request.method == 'DELETE':
            response = requests.delete(service_url, timeout=10)
        
        print("Request Accepted", flush=True)
        return response.content, response.status_code, response.headers.items()

    except requests.exceptions.Timeout:
        return jsonify({"error": "Request timed out"}), 504

    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 500

# Proxy request to beat upload with rate limiting
@app.route('/beats/upload', methods=['POST'])
@limiter.limit("5 per minute")  # Apply rate limiting to beat upload requests
def proxy_beat_upload():
    try:
        user_file_service_host, user_file_service_port = discover_service('userfile-service')
        notification_service_host, notification_service_port = discover_service('notification-service')

        if not user_file_service_host or not user_file_service_port:
            return jsonify({"error": "UserFile Service unavailable"}), 503
        
        service_url = f"http://{user_file_service_host}:{user_file_service_port}/beats/upload"
        
        if 'beat' in request.files:
            files = {'beat': request.files['beat']}
            data = {
                'title': request.form.get('title'),
                'artist': request.form.get('artist')
            }

            headers = {'Authorization': request.headers.get('Authorization')}
            response = requests.post(service_url, files=files, data=data, headers=headers, timeout=10)

            if response.status_code == 201 and notification_service_host and notification_service_port:
                # Notify notification service
                notify_url = f"http://{notification_service_host}:{notification_service_port}/notify-upload"
                notify_response = requests.post(notify_url, timeout=10)
                if notify_response.status_code == 200:
                    print("Notification sent successfully", flush=True)
                else:
                    print("Failed to send notification", flush=True)

            return response.content, response.status_code, response.headers.items()
        else:
            return jsonify({"error": "No file part in the request"}), 400

    except requests.exceptions.Timeout:
        return jsonify({"error": "Request timed out"}), 504

    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=3000, debug=True)
