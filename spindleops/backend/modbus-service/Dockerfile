FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir waitress flask pymodbus

COPY app.py /app/app.py

EXPOSE 8767

CMD ["python", "app.py"]
