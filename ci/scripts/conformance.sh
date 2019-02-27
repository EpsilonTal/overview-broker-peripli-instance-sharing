#!/bin/bash -e

cd overview-broker
npm install
npm start &

cd ../osb-checker-kotlin
./gradlew build

echo """
config:
  url: http://localhost
  port: 3000
  apiVersion: 2.14
  user: admin
  password: password

  provisionParameters:
    d2d814079edfd33f74b3b454fb666625:
      name: instance-name

  bindingParameters:
    d2d814079edfd33f74b3b454fb666625:
      name: instance-name
""" > application.yml

java -jar build/libs/osb-checker-kotlin-1.0.jar -cat -provision -bind -auth -con
