# Run the KrackAI API container in production-like mode
run-prod:
	@echo "Starting KrackAI API container (detached mode)..."
	docker run -d \
		--name krackai-api \
		-p 3000:3000 \
		-e PORT=3000 \
		-e MONGO_URI=mongodb://host.docker.internal:27017/siat \
		-e JWT_SECRET=$(JWT_SECRET) \
		-e JWT_EXPIRES_IN=1d \
		-e OPENAI_API_KEY=$(OPENAI_API_KEY) \
		-e EMAILJS_PUBLIC_KEY=O44lktYz21nQw9R_U \
		-e EMAILJS_PRIVATE_KEY=$(EMAILJS_PRIVATE_KEY) \
		-e EMAILJS_SERVICE_ID=$(EMAILJS_SERVICE_ID) \
		-e EMAILJS_TEMPLATE_ID=$(EMAILJS_TEMPLATE_ID) \
		kariqs/krackai-api:v4

# Stop and remove the container (safe even if not running)
stop-api:
	@echo "Stopping and removing krackai-api container if it exists..."
	docker stop krackai-api || true
	docker rm krackai-api || true

# Follow container logs
logs-api:
	docker logs -f krackai-api

# Restart: stop + run fresh
restart-api: stop-api run-prod

.PHONY: run-prod stop-api logs-api restart-api