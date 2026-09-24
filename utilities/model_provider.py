"""
Model Provider Utility

Handles initialization of different LLM providers (OpenAI, AWS Bedrock, etc.)
Can be easily extended to support additional providers.
"""

import os
import logging
from typing import Optional
from langchain_core.language_models.chat_models import BaseChatModel

logger = logging.getLogger(__name__)


def get_llm(
    provider: Optional[str] = None,
    model_name: Optional[str] = None,
    temperature: Optional[float] = None
) -> BaseChatModel:
    """
    Initialize and return an LLM based on the specified provider.
    
    Args:
        provider: Model provider name (e.g., "openai", "aws"). If None, reads from MODEL_PROVIDER env var.
        model_name: Model name/ID to use. If None, reads from MODEL_USED env var.
        temperature: Temperature setting. If None, reads from MODEL_TEMPERATURE env var.
    
    Returns:
        Initialized chat model instance
        
    Raises:
        ValueError: If provider is not supported or required configuration is missing
    """
    # Read from environment if not provided
    provider = provider or os.getenv("MODEL_PROVIDER", "openai")
    model_name = model_name or os.getenv("MODEL_USED", "gpt-5")
    temperature = temperature if temperature is not None else float(os.getenv("MODEL_TEMPERATURE", "0"))
    
    provider = provider.lower()
    
    logger.info(f"Initializing LLM: provider={provider}, model={model_name}, temperature={temperature}")
    
    if provider == "openai":
        return _get_openai_llm(model_name, temperature)
    elif provider == "azure":
        return _get_azure_openai_llm(model_name, temperature)
    elif provider == "aws":
        return _get_aws_bedrock_llm(model_name, temperature)
    else:
        raise ValueError(
            f"Unsupported model provider: {provider}. "
            f"Supported providers: 'openai', 'azure', 'aws'"
        )


def _get_openai_llm(model_name: str, temperature: float) -> BaseChatModel:
    """Initialize OpenAI ChatOpenAI model"""
    from langchain_openai import ChatOpenAI
    
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError(
            "OPENAI_API_KEY environment variable is required for OpenAI provider"
        )
    
    logger.info(f"Initializing OpenAI model: {model_name}")
    return ChatOpenAI(model=model_name, temperature=temperature)


def _get_azure_openai_llm(model_name: str, temperature: float) -> BaseChatModel:
    """Initialize an Azure OpenAI model (AzureChatOpenAI).

    Azure addresses a model by its *deployment name* on a resource endpoint,
    authenticated with a resource API key and a pinned API version — distinct
    from plain OpenAI (which uses only OPENAI_API_KEY + model name).

    Required env vars:
        AZURE_OPENAI_API_KEY   – key from the resource's "Keys and Endpoint" page
        AZURE_OPENAI_ENDPOINT  – e.g. https://tableauopenaidemo.openai.azure.com/
    Optional env vars:
        AZURE_OPENAI_DEPLOYMENT   – deployment name (defaults to model_name / MODEL_USED)
        AZURE_OPENAI_API_VERSION  – API version (defaults to a recent GA version)
    """
    from langchain_openai import AzureChatOpenAI

    api_key = os.getenv("AZURE_OPENAI_API_KEY")
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    # In Azure the deployment name is what actually selects the model; it may or
    # may not match the model name. Fall back to model_name (MODEL_USED) so a
    # same-named deployment works with no extra config.
    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT") or model_name
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21")

    missing = [
        name for name, value in (
            ("AZURE_OPENAI_API_KEY", api_key),
            ("AZURE_OPENAI_ENDPOINT", endpoint),
        ) if not value
    ]
    if missing:
        raise ValueError(
            "Missing required environment variable(s) for Azure OpenAI provider: "
            f"{', '.join(missing)}"
        )

    logger.info(
        f"Initializing Azure OpenAI: deployment={deployment}, "
        f"endpoint={endpoint}, api_version={api_version}"
    )
    return AzureChatOpenAI(
        azure_deployment=deployment,
        azure_endpoint=endpoint,
        api_key=api_key,
        api_version=api_version,
        temperature=temperature,
    )


def _get_aws_bedrock_llm(model_name: str, temperature: float) -> BaseChatModel:
    """Initialize AWS Bedrock ChatBedrockConverse model
    
    ChatBedrockConverse is required for tool calling with Claude models
    as it properly handles tool result message formatting and avoids the
    ValidationException error with tool_result.content.text.id.
    """
    from langchain_aws import ChatBedrockConverse
    
    region_name = os.getenv("AWS_REGION", "us-east-1")
    
    logger.info(f"Initializing AWS Bedrock model: {model_name} in region {region_name} using ChatBedrockConverse")
    
    # ChatBedrockConverse uses boto3, which will automatically use the AWS_* environment variables
    # It properly handles tool result formatting for Claude models (3.7, 4.5, etc.)
    # This avoids ValidationException errors with tool_result message formatting
    return ChatBedrockConverse(
        model_id=model_name,
        temperature=temperature,
        region_name=region_name
    )

