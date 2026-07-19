FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir waitress flask requests

COPY app.py /app/app.py

EXPOSE 8771

CMD ["python", "app.py"]
