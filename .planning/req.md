read mastra.ai docs.
read google adk yaml agent builder. 

our plan is to build a yaml agent builder. 
automatically scalable for various features of mastra.ai.

lets start with agent and model and tools only.

config.yaml
agent
   - agent1.yaml
   - agent2.yaml
model
    - model1.yaml
    - model2.yaml
tools
    - tool1.ts
    - tool2.ts

agent keys
- id
- name
- description
- instructiions
- tools []
- model

model keys
- id
- name
- temperature
- max_tokens

tool keys
- id
- name
- input_schema
- output_schema
- description
- code (typescript)

input and output schema are in ZOD format.
