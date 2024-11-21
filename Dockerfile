ARG BASE_IMAGE
ARG BUILD_IMAGE

FROM ${BUILD_IMAGE} as solidity-build
RUN apk add python3=3.11.10-r0 alpine-sdk=1.0-r1
USER node
WORKDIR /home/node
ADD --chown=node:node ./samples/solidity/package*.json ./
RUN npm install
ADD --chown=node:node ./samples/solidity .
RUN npx hardhat compile

FROM ${BUILD_IMAGE} as build
WORKDIR /root
ADD package*.json ./
RUN npm install
ADD . .
RUN npm run build

FROM alpine:3.19 AS SBOM
WORKDIR /
ADD . /SBOM
RUN apk add --no-cache curl 
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin v0.48.3
RUN trivy fs --format spdx-json --output /sbom.spdx.json /SBOM
RUN trivy sbom /sbom.spdx.json --severity UNKNOWN,HIGH,CRITICAL --db-repository public.ecr.aws/aquasecurity/trivy-db --exit-code 1

FROM $BASE_IMAGE
RUN apk add curl=8.9.1-r1
# We also need to keep copying it to the old location to maintain compatibility with the FireFly CLI
COPY --from=solidity-build --chown=1001:0 /home/node/artifacts/contracts/ERC1155MixedFungible.sol/ERC1155MixedFungible.json /root/contracts/
WORKDIR /app
ADD package*.json ./
RUN npm install --production
COPY --from=solidity-build /home/node/contracts contracts/source
COPY --from=solidity-build /home/node/artifacts/contracts/ERC1155MixedFungible.sol contracts
COPY --from=build /root/dist dist
COPY --from=build /root/.env /app/.env
RUN chgrp -R 0 /app/ \
    && chmod -R g+rwX /app/
COPY --from=SBOM /sbom.spdx.json /sbom.spdx.json
USER 1001
EXPOSE 3000
CMD ["node", "dist/src/main"]
