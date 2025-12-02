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
    model_name = model_name or os.getenv("MODEL_USED", "gpt-4")
    temperature = temperature if temperature is not None else float(os.getenv("MODEL_TEMPERATURE", "0"))
    
    provider = provider.lower()
    
    logger.info(f"Initializing LLM: provider={provider}, model={model_name}, temperature={temperature}")
    
    if provider == "openai":
        return _get_openai_llm(model_name, temperature)
    elif provider == "aws":
        return _get_aws_bedrock_llm(model_name, temperature)
    else:
        raise ValueError(
            f"Unsupported model provider: {provider}. "
            f"Supported providers: 'openai', 'aws'"
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


def _get_aws_bedrock_llm(model_name: str, temperature: float) -> BaseChatModel:
    """Initialize AWS Bedrock ChatBedrock model"""
    from langchain_aws import ChatBedrock
    
    # Check for required AWS credentials
    access_key = os.getenv("AWS_ACCESS_KEY_ID")
    secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
    region = os.getenv("AWS_REGION", "us-east-1")
    
    if not access_key or not secret_key:
        raise ValueError(
            "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables "
            "are required for AWS Bedrock provider"
        )    
    logger.info(f"Initializing AWS Bedrock model: {model_name} in region {region_name}")
    
    # ChatBedrock uses boto3, which will automatically use the AWS_* environment variables
    # We can optionally pass region_name explicitly if needed
    return ChatBedrock(model_id=model_name, temperature=temperature)

